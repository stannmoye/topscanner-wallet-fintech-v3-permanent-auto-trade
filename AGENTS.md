# Agent instructions for Arbitrade Platform

Before starting work, read root `progress.md` as a handoff index and verify its branch and commit SHA against GitHub. It is a status aid, not the source of truth: current code, canonical requirements, and exact-SHA CI evidence take precedence. Update it after each substantive development increment with changes, checks, and next steps. (Note: `progress.md` was not present in the repository root when this revision was written; record that gap rather than assuming its contents.)

Read these files before changing the application:

1. `BUILD_SOURCE.json` — canonical branch/build requirements and acceptance boundary.
2. `BUILD_AND_RELEASE.md` — build and release process.
3. `docs/REPOSITORY_GUIDE.md` — repository layout and source ownership.
4. **`docs/TRADING_SYSTEM_SPECIFICATION.md` — canonical trading requirements (see the owner-approved revision notice below).**
5. The acceptance or implementation document relevant to the files being changed.

## Owner-approved revision 2: pop-up internal-ledger wallet movement

The platform owner has approved the following product decision. It supersedes the earlier restrictions that forbade customer-fund reservation, debit, and credit during opportunity pop-ups.

**Authorized behaviour (internal ledger only):**

1. When an eligible pop-up opportunity appears for a customer, the server determines the **required investment amount** from the admin-configured capital policy for that opportunity.
2. The server places a **hold** on the required amount, first from the customer's **USD wallet** and then, if short, from other customer wallets (EUR, GBP, BTC, ETH, USDT and any other admin-enabled wallet) in the admin-configured wallet priority order. Balances are summed across wallets, converted with fresh timestamped FX evidence, and held in an all-or-none plan.
3. If the customer's USD balance plus all other eligible wallet balances (in USD equivalent) is **insufficient**, the server records the opportunity as **Missed — insufficient balance**. No partial hold or debit is made. The customer sees that the opportunity was missed because the balance does not qualify for the trade.
4. If the funds are sufficient, the server converts the hold into a **debit of the source wallets** and displays **Trade executing** after the pop-up has been shown. The debit, hold, and FX conversion entries are durable internal ledger entries.
5. After the pop-up/trade duration has closed and the server's settlement step confirms the outcome, the server **credits the customer's original reserved principal plus the configured return, minus the platform fee**. The platform fee is applied only to positive net return, at the admin-configured fee rate, and the fee is recorded as its own ledger entry.
6. Every wallet movement (hold, release, debit, FX conversion, credit, fee) is an internal ledger entry linked to the opportunity, the trade, and the source FX snapshot. Balances must always reconcile to the ledger.

**Labelling and claims:**

- The payout is a **configured/contractual return** defined by the admin-approved profit-percentage bounds, not market-earned profit, unless auditable external execution or result evidence exists. UI, API responses, and documents must use that label.
- Internal-ledger processing is not execution on an external market. Do not describe it as such.
- Opportunity estimates, countdowns, animations, and UI state are still never evidence of a completed result. Financial credit happens only through the server-side settlement record described above.

**Required guardrails (unchanged and still mandatory):**

- Every amount, rate, duration, fee rate, wallet priority order, and enable flag comes from the admin portal, is persisted with the opportunity once selected, is validated, and is audited. No value is hard-coded.
- Use integer basis points and minor-unit money math. Store capital, rate, duration, FX, and fee snapshots with the trade.
- Debits and holds are atomic and all-or-none across wallets. Use database row locks in a consistent order. Idempotency keys must prevent duplicate holds, debits, and credits on retries, restarts, or concurrent workers.
- Fail closed: if an FX quote is missing, stale, or invalid, or if the admin configuration is missing or malformed, do not hold or debit. Record a blocked/unavailable state instead.
- Workers must recover overdue jobs without resetting countdowns or duplicating debits or credits.
- Customer sign-out, refresh, local clock drift, scrolling, minimizing, or maximizing must not change timing, holds, debits, or settlement.
- Reversals, failures, and cancellations must be compensating ledger entries. Historical entries are never edited or deleted.

**Documentation gate:** the canonical specification (`docs/TRADING_SYSTEM_SPECIFICATION.md` §1.7, §5, §5A, §6), the companion PDF, the pop-up admin manual (`docs/TRADING_POPUP_ADMIN_CONFIGURATION_MANUAL.md`), `AUTOMATIC_TRADE_LIFECYCLE.md`, `FINANCIAL_AUTO_TRADE_HARDENING.md`, `PERMANENT_AUTO_TRADE_UNLOCK.md`, `DATABASE_SOURCE_OF_TRUTH.md`, and `README.md` must be updated to match this revision in a subsequent parallel update task.

---

## Guidance structure and concurrency

- AGENTS.md serves as the primary behavioral palate for agents/devs.
- `docs/TRADING_SYSTEM_SPECIFICATION.md` is the canonical requirements source of truth; any behavior change first secures a concrete owner/PM-approved revision in that spec.
- When AGENTS.md is the subject of a change, it must reflect the exact revision (including owner-approved revision notice) and flag any migrations in other docs.
- All other non-spec files should stay narrowly bounded to role-specific guidance and not duplicate functional behavior; they should reference the spec/AGENTS.md instead.