# GrupoVida - Proyecto SDF (SuiteCloud Development Framework)

Proyecto de personalizaciones de cuenta (**Account Customization Project - ACP**) para **Grupo Vida** gestionado mediante **SuiteCloud CLI** (SDF) de NetSuite.

---

## 📁 Estructura del Proyecto

```text
GrupoVida/
├── src/
│   ├── AccountConfiguration/       # Configuraciones de características y preferencias de la cuenta
│   ├── FileCabinet/                # Archivos del File Cabinet de NetSuite
│   │   ├── SuiteScripts/           # Scripts SuiteScript (Client, UserEvent, MapReduce, etc.)
│   │   ├── Templates/              # Plantillas de correo y marketing
│   │   └── Web Site Hosting Files/ # Archivos web / hosting
│   ├── Objects/                    # Definiciones XML de objetos personalizados (Custom Fields, Records, etc.)
│   ├── Translations/               # Archivos de traducción y localización
│   ├── deploy.xml                  # Manifiesto de despliegue que define qué elementos se publican
│   └── manifest.xml                # Manifiesto principal del proyecto SDF
├── suitecloud.config.js            # Configuración de SuiteCloud CLI
├── package.json                    # Atajos de comandos npm para SuiteCloud CLI
└── .gitignore                      # Reglas de exclusión para Git
```

---

## 🚀 Comandos Principales

Puedes usar directamente `suitecloud` o los atajos definidos en `package.json`:

### 1. Vincular Cuenta de NetSuite (TBA / OIDC)
```bash
npm run account:setup
# O directamente:
suitecloud account:setup
```

### 2. Validar Proyecto
Valida la sintaxis XML, dependencias y compatibilidad con la cuenta vinculada:
```bash
npm run validate
# O directamente:
suitecloud project:validate
```

### 3. Desplegar Cambios a NetSuite
Publica los objetos y scripts definidos en `deploy.xml`:
```bash
npm run deploy
# O directamente:
suitecloud project:deploy
```

### 4. Importar Objetos y Archivos desde NetSuite
```bash
# Listar objetos disponibles en la cuenta
npm run object:list

# Importar objetos personalizados específicos
npm run object:import

# Importar archivos desde el File Cabinet
npm run file:import
```

---

## 📌 Requisitos Previos

- **Node.js** (v18+)
- **SuiteCloud CLI for Node.js** (`npm install -g @oracle/suitecloud-cli`)
- Acceso con rol de Administrador o permisos de **SuiteCloud Development Framework** en la cuenta de NetSuite objetivo.
