/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 * Grupo Vida - Botón "Autoasignar lotes WMS" en Work Order
 */
// eslint-disable-next-line no-undef
define(['N/runtime', 'N/url', 'N/search', 'N/log'], (runtime, url, search, log) => {
    const SUITELET = { script: 'customscript_gv_sl_wo_autoasig', deploy: 'customdeploy_gv_sl_wo_autoasig' };
    const ALLOWED_STATUS = ['B', 'D']; // Liberada, En curso
    const ESTADO_ASIGNADA = '2';

    const hasBinTransfer = (woTranId) => {
        if (!woTranId) return false;
        try {
            const res = search.create({
                type: search.Type.BIN_TRANSFER,
                filters: [
                    ['mainline', 'is', 'T'],
                    'and',
                    ['memo', 'is', woTranId]
                ],
                columns: ['internalid']
            }).run().getRange({ start: 0, end: 1 });
            return res && res.length > 0;
        } catch (e) {
            log.error('GV_UE: Error verificando Bin Transfers', e.message);
            return false;
        }
    };

    const beforeLoad = (ctx) => {
        if (ctx.type !== ctx.UserEventType.VIEW) return;
        const rec = ctx.newRecord;
        const st = rec.getValue('status');
        const ost = rec.getValue('orderstatus');
        const tranId = rec.getValue('tranid');
        const estadoAutoasig = rec.getValue('custbodygv_estado_autoasig');

        log.debug('GV_UE: beforeLoad', {
            id: rec.id,
            tranId,
            status: st,
            orderstatus: ost,
            estadoAutoasig,
            user: runtime.getCurrentUser().id
        });

        // 1. Validar que la Work Order esté Liberada o En curso
        if (ALLOWED_STATUS.indexOf(st) === -1 && ALLOWED_STATUS.indexOf(ost) === -1) {
            log.debug('GV_UE: Botón omitido', `Estado de WO no permitido (status: ${st}, orderstatus: ${ost})`);
            return;
        }

        // 2. Si ya está Asignada, no mostrar el botón para evitar doble ejecución
        if (estadoAutoasig === ESTADO_ASIGNADA) {
            log.debug('GV_UE: Botón omitido', 'La Work Order ya se encuentra en estado Asignada');
            return;
        }

        // 3. Validar que exista al menos un Traslado al depósito (Bin Transfer) con la nota de esta WO
        if (!hasBinTransfer(tranId)) {
            log.debug('GV_UE: Botón omitido', `No existen Traslados al depósito con memo "${tranId}"`);
            return;
        }

        const link = url.resolveScript({
            scriptId: SUITELET.script,
            deploymentId: SUITELET.deploy,
            params: { woid: rec.id }
        });

        log.debug('GV_UE: Agregando botón', { woid: rec.id, tranId, suiteletLink: link });

        ctx.form.addButton({
            id: 'custpage_gv_autoasig',
            label: 'Autoasignar lotes WMS',
            functionName: `(function(){ if(confirm('¿Autoasignar lotes surtidos por WMS a esta Work Order?')) window.location.href='${link}'; })`
        });
    };

    return { beforeLoad };
});
