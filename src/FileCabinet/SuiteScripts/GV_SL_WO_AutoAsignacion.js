/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 * Grupo Vida - Autoasigna lote/bin a componentes de la WO según Bin Transfers de WMS.
 * - Los picks de WMS llevan el número de la WO en la Nota del Bin Transfer (ej. "WO113").
 * - Las reversas de picking de WMS NO llevan Nota: se emparejan por contenido
 *   (mismo artículo, lote y cantidad, con bin origen/destino invertidos).
 */
// eslint-disable-next-line no-undef
define(['N/record', 'N/search', 'N/redirect', 'N/format', 'N/log'], (record, search, redirect, format, log) => {

    const FLD_ESTADO = 'custbodygv_estado_autoasig';
    const ESTADO = { PENDIENTE: '1', ASIGNADA: '2', PARCIAL: '3', DIFERENCIA: '4', ERROR: '5' };
    const TOL = 0.00001;
    const key = (item, lot, bin) => [item, lot, bin].join('|');

    const getInventoryDetail = (rec, sublistId, line) => {
        try {
            if (rec.hasSublistSubrecord({ sublistId, fieldId: 'inventorydetail', line })) {
                return rec.getSublistSubrecord({ sublistId, fieldId: 'inventorydetail', line });
            }
            return rec.getSublistSubrecord({ sublistId, fieldId: 'inventorydetail', line });
        } catch (e) {
            log.debug('GV_SL: getInventoryDetail sin subrecord', `sublist: ${sublistId}, line: ${line}, error: ${e.message}`);
            return null;
        }
    };

    const readAssignments = (bt) => {
        const out = [];
        const n = bt.getLineCount({ sublistId: 'inventory' });
        for (let i = 0; i < n; i++) {
            const item = String(bt.getSublistValue({ sublistId: 'inventory', fieldId: 'item', line: i }));
            const inv = getInventoryDetail(bt, 'inventory', i);
            if (!inv) continue;
            const m = inv.getLineCount({ sublistId: 'inventoryassignment' });
            for (let j = 0; j < m; j++) {
                const g = f => inv.getSublistValue({ sublistId: 'inventoryassignment', fieldId: f, line: j });
                out.push({
                    item, 
                    lot: String(g('issueinventorynumber') || ''), 
                    qty: Number(g('quantity')) || 0,
                    from: String(g('binnumber') || ''), 
                    to: String(g('tobinnumber') || ''), 
                    reversed: false
                });
            }
        }
        log.debug('GV_SL: readAssignments BT ' + bt.id, { totalLineas: n, totalAsignaciones: out.length });
        return out;
    };

    const searchIds = (filters) => {
        const ids = [];
        search.create({ type: search.Type.BIN_TRANSFER, filters, columns: ['internalid'] })
            .run().each(r => { ids.push(r.id); return true; });
        return ids;
    };

    /** Surtido neto vigente por item|lote|bin, descontando reversas emparejadas. */
    const getNetPicked = (woTranId) => {
        const picks = [];
        let minDate = null;
        const pickIds = searchIds([['mainline', 'is', 'T'], 'and', ['memo', 'is', woTranId]]);
        log.debug('GV_SL: getNetPicked - BTs encontrados con nota', { woTranId, count: pickIds.length, ids: pickIds });

        pickIds.forEach(id => {
            const bt = record.load({ type: record.Type.BIN_TRANSFER, id });
            const d = bt.getValue('trandate');
            if (d && (!minDate || d < minDate)) minDate = d;
            const asigs = readAssignments(bt);
            log.debug('GV_SL: BT ' + id + ' leído', { trandate: d, asignaciones: asigs });
            asigs.forEach(a => picks.push(a));
        });
        if (!picks.length) {
            log.debug('GV_SL: getNetPicked - Sin picks', 'No se encontraron Bin Transfers para ' + woTranId);
            return [];
        }

        // Reversas: Bin Transfers sin Nota, desde la fecha del primer pick.
        const revFilters = [['mainline', 'is', 'T'], 'and', ['memo', 'isempty', '']];
        if (minDate) revFilters.push('and', ['trandate', 'onorafter', format.format({ value: minDate, type: format.Type.DATE })]);
        const revIds = searchIds(revFilters);
        log.debug('GV_SL: getNetPicked - Candidatos reversa', { minDate, count: revIds.length, ids: revIds });

        revIds.forEach(id => {
            const bt = record.load({ type: record.Type.BIN_TRANSFER, id });
            const asigs = readAssignments(bt);
            asigs.forEach(r => {
                const p = picks.find(x => !x.reversed && x.item === r.item && x.lot === r.lot &&
                    Math.abs(x.qty - r.qty) < TOL && x.to === r.from && x.from === r.to);
                if (p) {
                    p.reversed = true;
                    log.debug('GV_SL: Reversa emparejada', { pickEmparejado: p, reversa: r });
                }
            });
        });

        const net = {};
        picks.filter(p => !p.reversed).forEach(p => {
            if (p.to) net[key(p.item, p.lot, p.to)] = (net[key(p.item, p.lot, p.to)] || 0) + p.qty;
            if (p.from) net[key(p.item, p.lot, p.from)] = (net[key(p.item, p.lot, p.from)] || 0) - p.qty;
        });
        const result = Object.keys(net).filter(k => net[k] > TOL).map(k => {
            const [item, lot, bin] = k.split('|');
            return { item, lot, bin, qty: net[k] };
        });
        log.debug('GV_SL: getNetPicked - Surtido neto final', result);
        return result;
    };

    const setEstado = (woId, estado) => {
        log.debug('GV_SL: setEstado', { woId, estado });
        return record.submitFields({
            type: record.Type.WORK_ORDER, id: woId, values: { [FLD_ESTADO]: estado },
            options: { enableSourcing: false, ignoreMandatoryFields: true }
        });
    };

    const onRequest = (ctx) => {
        const woId = ctx.request.parameters.woid;
        const back = () => redirect.toRecord({ type: record.Type.WORK_ORDER, id: woId });
        log.debug('GV_SL: onRequest inicio', { woId, parameters: ctx.request.parameters });

        try {
            const wo = record.load({ type: record.Type.WORK_ORDER, id: woId, isDynamic: false });
            const tranId = wo.getValue('tranid');
            const lines = wo.getLineCount({ sublistId: 'item' });
            log.debug('GV_SL: WO cargada', { tranId, lines, status: wo.getValue('status'), orderstatus: wo.getValue('orderstatus') });

            const picked = getNetPicked(tranId);
            log.audit('GV autoasig ' + tranId, 'surtido neto: ' + JSON.stringify(picked) + ' | lineas WO: ' + lines);

            // Validación todo-o-nada para componentes que manejan inventario asignable:
            // Si la línea no tiene inventario asignable (no soporta inventorydetail), se omite sin generar error
            // permitiendo que el resto de líneas se procese.
            const plan = []; let ok = picked.length > 0;
            for (let i = 0; i < lines && ok; i++) {
                const sub = getInventoryDetail(wo, 'item', i);
                const item = String(wo.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));
                const req = Number(wo.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0;

                if (!sub) {
                    log.debug('GV_SL: Línea ' + i + ' omitida', { item, req, motivo: 'Sin inventario asignable / sin subrecord' });
                    continue;
                }

                const mine = picked.filter(p => p.item === item);
                const got = mine.reduce((s, p) => s + p.qty, 0);
                log.debug('GV_SL: Línea ' + i + ' evaluada', { item, req, got, countPicks: mine.length });

                if (Math.abs(got - req) > TOL) {
                    ok = false;
                    log.audit('GV autoasig diferencia', 'linea ' + i + ' item ' + item + ' requerido ' + req + ' surtido ' + got);
                    log.debug('GV_SL: Diferencia detectada en línea ' + i, { item, requerido: req, surtido: got });
                } else {
                    plan.push({ line: i, mine });
                }
            }
            if (!ok) {
                const nuevoEstado = picked.length ? ESTADO.DIFERENCIA : ESTADO.PENDIENTE;
                log.debug('GV_SL: Validación no superada, asignando estado', { nuevoEstado, totalPicks: picked.length });
                setEstado(woId, nuevoEstado);
                return back();
            }

            // El bin NO se asigna en la WO (el detalle del componente no tiene bin): queda para el Work Order Issue.
            // Idempotente: si el detalle ya coincide con el surtido, no se toca (re-asignar los mismos lotes
            // fallaria porque ya estan comprometidos con esta misma WO).
            let changed = false;
            log.debug('GV_SL: Procesando asignación del plan', { totalLineasAsignables: plan.length });

            plan.forEach(({ line, mine }) => {
                const byLot = {};
                mine.forEach(p => { byLot[p.lot] = (byLot[p.lot] || 0) + p.qty; });
                const sub = getInventoryDetail(wo, 'item', line);
                if (!sub) return;
                const cur = {};
                for (let k = 0; k < sub.getLineCount({ sublistId: 'inventoryassignment' }); k++) {
                    const l = String(sub.getSublistValue({ sublistId: 'inventoryassignment', fieldId: 'issueinventorynumber', line: k }));
                    cur[l] = (cur[l] || 0) + (Number(sub.getSublistValue({ sublistId: 'inventoryassignment', fieldId: 'quantity', line: k })) || 0);
                }
                const lots = Object.keys(byLot);
                const isIdentical = lots.length === Object.keys(cur).length && lots.every(l => cur[l] !== undefined && Math.abs(cur[l] - byLot[l]) < TOL);
                log.debug('GV_SL: Comparando detalle línea ' + line, { lotsSurtidos: byLot, lotsActuales: cur, esIdentico: isIdentical });

                if (isIdentical) return;
                changed = true;
                log.debug('GV_SL: Reasignando lotes en línea ' + line, byLot);

                for (let k = sub.getLineCount({ sublistId: 'inventoryassignment' }) - 1; k >= 0; k--)
                    sub.removeLine({ sublistId: 'inventoryassignment', line: k });
                lots.forEach((lot, idx) => {
                    try {
                        sub.setSublistValue({ sublistId: 'inventoryassignment', fieldId: 'issueinventorynumber', line: idx, value: lot });
                    } catch (e) {
                        log.error('GV lote rechazado', 'lote ' + lot + ' linea ' + line + ' | ' + e.message);
                        throw e;
                    }
                    sub.setSublistValue({ sublistId: 'inventoryassignment', fieldId: 'quantity', line: idx, value: byLot[lot] });
                });
            });

            if (!changed) {
                log.debug('GV_SL: Idempotencia - Sin cambios necesarios', { woId, estado: ESTADO.ASIGNADA });
                setEstado(woId, ESTADO.ASIGNADA);
                log.audit('GV autoasig OK', 'WO ' + woId + ' ya estaba asignada, sin cambios');
                return back();
            }

            log.debug('GV_SL: Guardando WO con estado Asignada', { woId });
            wo.setValue({ fieldId: FLD_ESTADO, value: ESTADO.ASIGNADA });
            try {
                wo.save({ ignoreMandatoryFields: true });
                log.debug('GV_SL: WO guardada exitosamente', { woId });
            } catch (saveErr) {
                const lotInfo = {};
                plan.forEach(({ line, mine }) => mine.forEach(p => {
                    if (lotInfo[p.lot]) return;
                    try { lotInfo[p.lot] = search.lookupFields({ type: 'inventorynumber', id: p.lot, columns: ['inventorynumber', 'item', 'location'] }); }
                    catch (x) { lotInfo[p.lot] = 'lookup fallo: ' + x.message; }
                }));
                const locs = plan.map(pl => 'l' + pl.line + '=' + wo.getSublistValue({ sublistId: 'item', fieldId: 'location', line: pl.line }));
                log.error('GV save rechazado', saveErr.message + ' | lotes: ' + JSON.stringify(lotInfo) + ' | ubic lineas: ' + locs.join(',') + ' | ubic WO: ' + wo.getValue('location'));
                throw saveErr;
            }
            log.audit('GV autoasig OK', 'WO ' + woId + ' asignada, componentes: ' + plan.length);
        } catch (e) {
            log.error('GV autoasignacion WO ' + woId, e.name + ': ' + e.message);
            try { setEstado(woId, ESTADO.ERROR); } catch (x) { /* noop */ }
        }
        back();
    };
    return { onRequest };
});
