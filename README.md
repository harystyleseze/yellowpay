# YellowPay

Instant gasless payments from any chain, with built-in cross-chain yield on Aave V3.

## What It Does

YellowPay is a multi-chain payment and yield platform powered by Yellow Network state channels.

| Tab | Description |
|-----|-------------|
| **Pay** | Send instant, gasless payments via ENS/DNS names. Balance mode (off-chain transfer) or Any Token mode (LI.FI swap/bridge → Yellow deposit → instant transfer). |
| **Fund** | Deposit tokens from any supported chain into Yellow Network using LI.FI cross-chain routing. |
| **Withdraw** | Close or resize state channels to settle funds back on-chain. |
| **Earn** | Deposit into Aave V3 lending vaults on Ethereum, Base, and Polygon. Live on-chain APY. Cross-chain deposits via LI.FI. |
| **History** | Transaction log with type filtering (payments, deposits, withdrawals, earn). |

**Supported Chains:** Ethereum, BNB Smart Chain, Polygon, World Chain, Base, Linea, XRPL EVM Sidechain

**Supported Assets:** USDC, USDT, ETH, WETH, BNB, LINK, XRP, Beatwav

## Architecture

```
User Wallet (any chain, any token)
       │
       ▼
   [ LI.FI API ]  ── swap + bridge ──▶  Settlement Token on Target Chain
       │
       ▼
   [ NitroliteClient ]  ── custody deposit ──▶  Yellow Network (on-chain)
       │
       ▼
   [ Yellow Network WS ]  ── off-chain transfer ──▶  Recipient (instant, gasless)
```

- **Off-chain state channels** for instant gasless payments (hub-and-spoke via Yellow Network)
- **LI.FI** for "pay from anywhere" — any token on any chain routed to settlement
- **Session-based auth** with EIP-712 signed ephemeral keys (24-hour sessions)
- **On-chain settlement only on withdrawal** (channel close)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router, Turbopack) · React 18 · TypeScript |
| Styling | Tailwind CSS 4 |
| Wallet | wagmi 2.14 · RainbowKit 2.2 · viem 2.21 |
| State Channels | @erc7824/nitrolite 0.5.3 (Yellow Network SDK) |
| Cross-Chain | LI.FI REST API (li.quest/v1) — custom client |
| Yield | Aave V3 on-chain reads (Pool.getReserveData, aToken balanceOf) |
| Identity | ENS resolution · CCIP-Read (ERC-3668) · avatars · text records |
| Data | React Query · localStorage persistence |

## Getting Started

### Prerequisites

- Node.js 18+
- A WalletConnect Project ID ([cloud.walletconnect.com](https://cloud.walletconnect.com))

### Setup

```bash
git clone https://github.com/harystyleseze/yellowpay.git
cd yellowpay
npm install
cp .env.example .env
```

Edit `.env`:

```env
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id_here
NEXT_PUBLIC_YELLOW_WS=wss://clearnet-sandbox.yellow.com/ws
# NEXT_PUBLIC_LIFI_API_KEY=optional_for_higher_rate_limits
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Modes

| Mode | WebSocket URL | Behavior |
|------|--------------|----------|
| Sandbox | `wss://clearnet-sandbox.yellow.com/ws` | Testnet chains, ytest.usd |
| Production | `wss://clearnet.yellow.com/ws` | Mainnet chains, real assets |

## Project Structure

```
src/
├── app/
│   ├── page.tsx              Main page with 5-tab navigation
│   └── layout.tsx            Root layout with Providers
├── components/
│   ├── PaymentForm.tsx       Pay tab — balance + wallet payment modes
│   ├── FundAccount.tsx       Fund tab — LI.FI deposit flow
│   ├── WithdrawForm.tsx      Withdraw tab — channel close/resize
│   ├── EarnDashboard.tsx     Earn tab — Aave V3 vaults + positions
│   ├── TxHistory.tsx         History tab
│   ├── ENSInput.tsx          ENS/DNS recipient input with resolution
│   └── Providers.tsx         wagmi + RainbowKit + React Query
├── hooks/
│   ├── useYellow.ts          Yellow Network WebSocket, auth, transfers
│   ├── useLiFi.ts            LI.FI quotes, chains, tokens, status polling
│   ├── useENS.ts             ENS resolution, avatars, text records
│   ├── useEarn.ts            Aave V3 vault fetch + position tracking
│   └── useTxHistory.ts       Transaction history hook
└── lib/
    ├── constants.ts          Chains, contracts, assets, settlement tokens
    ├── wagmi.ts              wagmi/RainbowKit config
    ├── txHistory.ts          localStorage tx persistence
    ├── lifi/
    │   ├── client.ts         LI.FI REST client
    │   ├── types.ts          LI.FI TypeScript interfaces
    │   └── index.ts          LI.FI service export
    └── earn/
        ├── client.ts         Aave V3 on-chain vault discovery + APY
        ├── types.ts          Earn TypeScript interfaces
        └── index.ts          Earn service export
```

## License

MIT
