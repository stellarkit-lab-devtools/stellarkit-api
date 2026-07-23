# StellarKit API 🚀

<p align="center">
  <a href="README.md">English 🇺🇸</a> | <b>Français 🇫🇷</b> | <a href="README.es.md">Español 🇪🇸</a>
</p>

> Une API REST utilitaire pour les développeurs sur la blockchain Stellar — construite avec Express.js et le SDK Stellar officiel.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![Stellar](https://img.shields.io/badge/Stellar-SDK-blue)](https://stellar.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

StellarKit API encapsule l'[API Horizon de Stellar](http://web.archive.org/web/20240226022606/http://web.archive.org/web/20240226022606/https://developers.stellar.org/api/horizon) dans des points de terminaison (endpoints) REST clairs et adaptés aux développeurs. Elle aide les développeurs créant sur Stellar à accéder rapidement aux estimations de frais, aux données de compte, à l'historique des transactions, à l'état du réseau et aux métadonnées des actifs — sans avoir à analyser les réponses brutes d'Horizon.

---

## ✨ Fonctionnalités

- 📊 **État du réseau** — Informations sur le dernier registre (ledger), frais de base, version du protocole
- 💸 **Estimation des frais** — Niveaux de frais Économique / Standard / Prioritaire pour n'importe quel nombre d'opérations
- 👤 **Informations de compte** — Soldes (XLM + tous les actifs), signataires, seuils, solde disponible (spendable balance)
- 📜 **Historique des transactions** — Transactions et opérations paginées par compte
- 🪙 **Métadonnées des actifs** — Statistiques pour n'importe quel actif Stellar, ainsi qu'une recherche multi-émetteur
- 🛡️ **Prêt pour la production** — Limitation du taux (rate limiting), en-têtes de sécurité Helmet, gestion centralisée des erreurs
- ✅ **Testé** — Suite de tests Jest avec couverture (coverage)

---

## 🚀 Démarrage rapide

### Prérequis

- Node.js >= 18
- npm >= 9

### Installation

```bash
git clone https://github.com/stellarkit-lab-devtools/stellarkit-api.git
cd stellarkit-api
npm install
cp .env.example .env
```

### Configuration

Modifiez le fichier `.env` :

```env
STELLAR_NETWORK=testnet     # ou "mainnet"
PORT=3000
```

### Exécution

```bash
# Développement (rechargement automatique)
npm run dev

# Production
npm start
```

L'API sera disponible sur `http://localhost:3000`.

---

## 📡 Points de terminaison de l'API (Endpoints)

### `GET /`
Retourne la liste complète des points de terminaison disponibles.

---

### `GET /health`
Vérification de l'état de santé du service.

**Réponse :**
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
Retourne les informations du dernier registre (ledger), les frais et la version du protocole.

**Réponse :**
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
Retourne les niveaux de frais Économique / Standard / Prioritaire basés sur les statistiques en direct du réseau.

**Paramètres de requête (Query params) :**
| Paramètre | Type | Par défaut | Description |
|-----------|------|------------|-------------|
| `operations` | number | `1` | Nombre d'opérations dans votre transaction |

**Exemple :**
```
GET /fee-estimate?operations=3
```

**Réponse :**
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
Retourne les détails complets d'un compte pour une clé publique Stellar donnée.

**Exemple :**
```
GET /account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
```

**Réponse :**
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
Retourne l'historique paginé des transactions d'un compte.

**Paramètres de requête (Query params) :**
| Paramètre | Type | Par défaut | Description |
|-----------|------|------------|-------------|
| `limit` | number | `10` | Nombre de résultats (max 200) |
| `order` | string | `desc` | `asc` ou `desc` |
| `cursor` | string | — | Curseur de pagination de la réponse précédente |

---

### `GET /transactions/:id/operations`
Retourne l'historique paginé des opérations d'un compte. Même paramètres de requête que ci-dessus.

---

### `GET /asset/:code/:issuer`
Retourne les métadonnées et statistiques pour un actif Stellar spécifique.

**Exemple :**
```
GET /asset/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
```

---

### `GET /asset/search?code=:code`
Recherche tous les actifs correspondant à un code donné à travers tous les émetteurs.

**Exemple :**
```
GET /asset/search?code=USDC
```

---

## 🧪 Exécution des tests

```bash
npm test
```

Les tests utilisent [Jest](https://jestjs.io/) + [Supertest](https://github.com/ladjs/supertest). Le rapport de couverture est généré dans `coverage/`.

---

## 🤝 Contribution

Les contributions sont les bienvenues ! Ce projet participe au programme **[Stellar Wave Program on Drips](https://www.drips.network/wave/stellar)** — vous pouvez gagner des récompenses en résolvant des issues ouvertes.

**Pour contribuer :**

1. Forkez le dépôt
2. Créez une branche de fonctionnalité : `git checkout -b feat/votre-fonctionnalite`
3. Commitez vos modifications : `git commit -m "feat: ajouter votre fonctionnalité"`
4. Poussez et ouvrez une Pull Request (PR)

Veuillez lire [CONTRIBUTING.md](CONTRIBUTING.md) avant de soumettre.

---

## 📁 Structure du Projet

```
stellarkit-api/
├── src/
│   ├── config/
│   │   └── stellar.js         # Configuration du SDK Stellar + Horizon
│   ├── middleware/
│   │   ├── errorHandler.js    # Formatage centralisé des erreurs
│   │   └── rateLimiter.js     # Limitation du taux (rate limiting)
│   ├── routes/
│   │   ├── account.js         # Points de terminaison /account
│   │   ├── asset.js           # Points de terminaison /asset
│   │   ├── feeEstimate.js     # Point de terminaison /fee-estimate
│   │   ├── networkStatus.js   # Point de terminaison /network-status
│   │   └── transactions.js    # Points de terminaison /transactions
│   ├── utils/
│   │   ├── response.js        # Utilitaires de réponse
│   │   └── validators.js      # Utilitaires de validation des entrées
│   └── index.js               # Point d'entrée de l'application
├── tests/
│   └── api.test.js
├── .env.example
├── package.json
└── README.md
```

---

## 🌐 Ressources Stellar

- [Portail des Développeurs Stellar](https://developers.stellar.org)
- [SDK JavaScript Stellar](https://github.com/stellar/js-stellar-sdk)
- [Référence de l'API Horizon](https://developers.stellar.org/api/horizon)
- [Discord Stellar](https://discord.gg/stellardev)
- [Programme Stellar Wave](https://www.drips.network/wave/stellar)

---

## 📄 Licence

[MIT](LICENSE)
