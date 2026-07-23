# StellarKit API 🚀

<p align="center">
  <a href="README.md">English 🇺🇸</a> | <a href="README.fr.md">Français 🇫🇷</a> | <b>Español 🇪🇸</b>
</p>

> Una API REST de utilidad para desarrolladores en la blockchain Stellar — construida con Express.js y el SDK oficial de Stellar.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![Stellar](https://img.shields.io/badge/Stellar-SDK-blue)](https://stellar.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

StellarKit API envuelve la [API Horizon de Stellar](http://web.archive.org/web/20240226022606/http://web.archive.org/web/20240226022606/https://developers.stellar.org/api/horizon) en puntos de conexión (endpoints) REST limpios y amigables para desarrolladores. Ayuda a los desarrolladores que construyen en Stellar a acceder rápidamente a estimaciones de tarifas, datos de cuentas, historial de transacciones, estado de la red y metadatos de activos, sin tener que analizar las respuestas en bruto de Horizon.

---

## ✨ Características

- 📊 **Estado de la red** — Información del último registro (ledger), tarifa base, versión del protocolo
- 💸 **Estimación de comisiones** — Niveles de tarifas Económica / Estándar / Prioritaria para cualquier número de operaciones
- 👤 **Información de cuenta** — Saldos (XLM + todos los activos), firmantes, umbrales, saldo disponible (spendable balance)
- 📜 **Historial de transacciones** — Transacciones y operaciones paginadas por cuenta
- 🪙 **Metadatos de activos** — Estadísticas para cualquier activo de Stellar, además de búsqueda multiemisor
- 🛡️ **Listo para producción** — Limitación de tasa (rate limiting), cabeceras de seguridad Helmet, manejo centralizado de errores
- ✅ **Probado** — Suite de pruebas Jest con cobertura de código

---

## 🚀 Empezando

### Prerrequisitos

- Node.js >= 18
- npm >= 9

### Instalación

```bash
git clone https://github.com/stellarkit-lab-devtools/stellarkit-api.git
cd stellarkit-api
npm install
cp .env.example .env
```

### Configuración

Edite el archivo `.env`:

```env
STELLAR_NETWORK=testnet     # o "mainnet"
PORT=3000
```

### Ejecutar

```bash
# Desarrollo (recarga automática)
npm run dev

# Producción
npm start
```

La API estará disponible en `http://localhost:3000`.

---

## 📡 Puntos de conexión (Endpoints) de la API

### `GET /`
Devuelve la lista completa de los puntos de conexión disponibles.

---

### `GET /health`
Verificación de estado (health check) del servicio.

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "StellarKit API",
    "version": "1.0.0",
    "network": "testnet"
  }
}
```

---

### `GET /network-status`
Devuelve la información del último registro (ledger), tarifas y versión del protocolo.

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "network": "testnet",
    "latestLedger": {
      "sequence": 123456,
      "closedAt": "2024-07-01T12:00:00Z",
      "transactionCount": 42,
      "operationCount": 89
    },
    "fees": {
      "baseFeeInStroops": 100,
      "baseFeeInXLM": "0.0000100"
    },
    "protocol": { "version": 21 }
  }
}
```

---

### `GET /fee-estimate`
Devuelve los niveles de tarifas Económica / Estándar / Prioritaria basados en las estadísticas de la red en vivo.

**Parámetros de consulta (Query params):**
| Parámetro | Tipo | Por defecto | Descripción |
|-----------|------|-------------|-------------|
| `operations` | number | `1` | Número de operaciones en su transacción |

**Ejemplo:**
```
GET /fee-estimate?operations=3
```

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "operationCount": 3,
    "perOperation": {
      "economy":  { "stroops": 100, "xlm": "0.0000100" },
      "standard": { "stroops": 200, "xlm": "0.0000200" },
      "priority": { "stroops": 500, "xlm": "0.0000500" }
    },
    "totalFee": {
      "economy":  { "stroops": 300, "xlm": "0.0000300" },
      "standard": { "stroops": 600, "xlm": "0.0000600" },
      "priority": { "stroops": 1500, "xlm": "0.0001500" }
    }
  }
}
```

---

### `GET /account/:id`
Devuelve los detalles completos de una cuenta para una clave pública Stellar.

**Ejemplo:**
```
GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
```

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4...",
    "sequence": "12345678",
    "xlm": {
      "balance": "100.0000000",
      "minimumBalance": "1.0000000",
      "spendableBalance": "99.0000000"
    },
    "assets": [...],
    "signers": [...],
    "flags": {...}
  }
}
```

---

### `GET /transactions/:id`
Devuelve el historial paginado de transacciones para una cuenta.

**Parámetros de consulta (Query params):**
| Parámetro | Tipo | Por defecto | Descripción |
|-----------|------|-------------|-------------|
| `limit` | number | `10` | Número de resultados (máx 200) |
| `order` | string | `desc` | `asc` o `desc` |
| `cursor` | string | — | Cursor de paginación de la respuesta anterior |

---

### `GET /transactions/:id/operations`
Devuelve el historial paginado de operaciones para una cuenta. Mismos parámetros de consulta que arriba.

---

### `GET /asset/:code/:issuer`
Devuelve los metadatos y estadísticas para un activo específico de Stellar.

**Ejemplo:**
```
GET /asset/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
```

---

### `GET /asset/search?code=:code`
Busca todos los activos con un código dado entre todos los emisores.

**Ejemplo:**
```
GET /asset/search?code=USDC
```

---

## 🧪 Ejecutando Pruebas

```bash
npm test
```

Las pruebas utilizan [Jest](https://jestjs.io/) + [Supertest](https://github.com/ladjs/supertest). El informe de cobertura se genera en `coverage/`.

---

## 🤝 Contribuir

¡Las contribuciones son muy bienvenidas! Este proyecto participa en el **[Stellar Wave Program en Drips](https://www.drips.network/wave/stellar)** — puedes ganar recompensas resolviendo problemas (issues) abiertos.

**Para contribuir:**

1. Haz un fork del repositorio
2. Crea una rama para tu característica: `git checkout -b feat/tu-caracteristica`
3. Confirma tus cambios: `git commit -m "feat: agregar tu característica"`
4. Sube la rama y abre un Pull Request

Por favor, lee [CONTRIBUTING.md](CONTRIBUTING.md) antes de enviar contribuciones.

---

## 📁 Estructura del Proyecto

```
stellarkit-api/
├── src/
│   ├── config/
│   │   └── stellar.js         # Configuración de Stellar SDK + Horizon
│   ├── middleware/
│   │   ├── errorHandler.js    # Formato centralizado de errores
│   │   └── rateLimiter.js     # Limitación de tasa (rate limiting)
│   ├── routes/
│   │   ├── account.js         # Puntos de conexión para /account
│   │   ├── asset.js           # Puntos de conexión para /asset
│   │   ├── feeEstimate.js     # Punto de conexión para /fee-estimate
│   │   ├── networkStatus.js   # Punto de conexión para /network-status
│   │   └── transactions.js    # Puntos de conexión para /transactions
│   ├── utils/
│   │   ├── response.js        # Ayudantes de respuesta
│   │   └── validators.js      # Ayudantes de validación de entrada
│   └── index.js               # Punto de entrada de la aplicación
├── tests/
│   └── api.test.js
├── .env.example
├── package.json
└── README.md
```

---

## 🌐 Recursos de Stellar

- [Portal de Desarrolladores de Stellar](https://developers.stellar.org)
- [Stellar JavaScript SDK](https://github.com/stellar/js-stellar-sdk)
- [Referencia de la API Horizon](https://developers.stellar.org/api/horizon)
- [Stellar Discord](https://discord.gg/stellardev)
- [Stellar Wave Program](https://www.drips.network/wave/stellar)

---

## 📄 Licencia

[MIT](LICENSE)
