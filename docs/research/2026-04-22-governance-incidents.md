# Governance security incidents — baseline research (Plan 02)

> **Purpose:** Ground Plan 02 §5.1 detector inventory in reproducible on-chain signals observed in real incidents. Every detector proposed in §5 at the bottom of this document is anchored to at least one case below.
>
> **Scope:** Ethereum-flavoured governance primitives (OZ Governor, Compound Governor Bravo, Gnosis Safe, Timelocks, EIP-1967/1822/transparent proxies, ERC20Votes/ERC721Votes). Solana cases are included for pattern study even though Plan 02 EVM-only.
>
> **Method:** Public post-mortems + security-firm write-ups + block explorer traces. Quoted excerpts are ≤15 words and capped at one per source; everything else is paraphrased.
>
> **Date:** 2026-04-22. Author: Breakwater team (pre-Plan-02 scoping).

---

## Incident 1 — Drift Protocol (April 1, 2026, ~$285M, Solana)

- **Chain:** Solana mainnet
- **Loss:** ~$285M (USDC, SOL, ETH) — over half of Drift's TVL at time of attack
- **Attack vector:** Six-month social-engineering operation attributed with medium confidence to DPRK-linked actors (UNC4736). Attackers used Solana's durable-nonces feature to coax Security Council signers into pre-signing transactions that handed over admin authority; once admin, the attackers whitelisted a fake token (CVT), deposited 500M of it, and withdrew real collateral.
- **Governance primitives involved:** Drift Security Council migrated on March 26, 2026 (days before the attack) from a larger multisig to a 2-of-5 threshold with **"zero timelock"** per Chainalysis write-up. No on-chain delay existed between signer approval and state change.
- **Pre-incident visible signals:**
  - (i) The multisig migration on March 26 is publicly visible on-chain — threshold drop + timelock removal in the same admin change is a structurally detectable event.
  - (ii) CVT token deployment + artificial wash-trading began ~3 weeks before execution — listable via DEX analytics, outside Breakwater's scanner scope.
  - (iii) Durable nonce accounts created March 23; these are inspectable but pattern-of-use detection is non-trivial.
  - (iv) Staging wallet funded from Tornado Cash March 10-11, 2026 — attribution signal, not a governance signal.
- **Detector coverage:**
  - **Would catch:** GOV-001 (missing / zero timelock after admin change) — the March 26 migration directly removed the delay window that, per Chainalysis, "eliminated the detection and intervention window."
  - **Would catch:** GOV-003 (multisig threshold risk) — 2-of-5 threshold with signer-set overlapping protocol team is flaggable independent of the exploit chain.
  - **Would not catch:** Social engineering / durable-nonce pre-signing is off-chain; Breakwater's scope is on-chain state only.
- **References:**
  - [Chainalysis — Lessons from the Drift hack](https://www.chainalysis.com/blog/lessons-from-the-drift-hack/)
  - [TRM Labs — North Korean hackers attack Drift](https://www.trmlabs.com/resources/blog/north-korean-hackers-attack-drift-protocol-in-285-million-heist)
  - [The Hacker News — Six-month DPRK operation](https://thehackernews.com/2026/04/285-million-drift-hack-traced-to-six.html)

---

## Incident 2 — Beanstalk Farms (April 17, 2022, ~$182M, Ethereum)

- **Chain:** Ethereum mainnet
- **Loss:** ~$182M (ETH + BEAN drained from Beanstalk Diamond contract)
- **Attack vector:** Attacker took a ~$1B flash loan across DAI/USDC/USDT on Aave, converted into Curve LP tokens (BEAN3Crv-f + BEANLUSD-f), deposited them into the Beanstalk Silo to gain Stalk voting power, passed malicious proposal **BIP-18**, and executed via the protocol's own `emergencyCommit()` path. Funds laundered through Tornado Cash; $250K donated to Ukraine.
- **Governance primitives involved:**
  - Custom governance on a Diamond (EIP-2535) contract — not OZ Governor, not Governor Bravo.
  - Voting power = Stalk-in-Silo at time of call, with no snapshot to an earlier block height.
  - 24-hour delay between proposal + execution existed, but `emergencyCommit()` allowed same-block execution after the delay expired — and crucially, there was no anti-flash-loan gate on vote weight, per CertiK: "lacking anti-flashloan mechanism in the Beanstalk protocol."
- **Pre-incident visible signals:**
  - (i) Governance contract exposes `emergencyCommit()` or equivalent bypass function — statically detectable from ABI.
  - (ii) Vote-weight logic reads from current balance (not `getPastVotes()` / block-height snapshot) — detectable via source-code inspection or bytecode pattern.
  - (iii) BIP-18 proposal itself was visible in the mempool/on-chain proposal queue for ~24 hours before execution — simulation of its effects would have flagged the drain.
- **Detector coverage:**
  - **Would catch:** GOV-002 (governance bypass / emergency execution path present) — `emergencyCommit` is the literal detector trigger.
  - **Would catch:** GOV-004 (flash-loan-vulnerable vote weighting) — vote weight not snapshot-protected.
  - **Future extension:** proposal simulation (execute in a fork, check for treasury outflow) would have flagged BIP-18 directly — out of Plan 02 scope, candidate for Plan 03+.
- **References:**
  - [CertiK — Revisiting Beanstalk Farms Exploit](https://www.certik.com/resources/blog/6HaLMGIL5sI2fpfEZc0nzS-revisiting-beanstalk-farms-exploit)
  - [Cointelegraph — DeFi governance exploit](https://cointelegraph.com/news/beanstalk-farms-loses-182m-in-defi-governance-exploit)
  - [CoinDesk — Attacker drains $182M](https://www.coindesk.com/tech/2022/04/17/attacker-drains-182m-from-beanstalk-stablecoin-protocol)
  - [Omniscia post-mortem (via Coinmonks)](https://medium.com/coinmonks/beanstalk-exploit-a-simplified-post-mortem-analysis-92e6cdb17ace)

---

## Incident 3 — Compound Proposal 62 (October 2, 2021, ~$80M at risk, Ethereum)

- **Chain:** Ethereum mainnet
- **Loss:** Up to ~$80M in over-distributed COMP tokens (bounded maximum); ~$50M actually claimed at time of public disclosure.
- **Attack vector:** Not a malicious attack — a governance-approved code upgrade (Proposal 62) replaced the Comptroller contract to implement dynamic COMP reward distribution. The new Comptroller contained a comparison-operator bug (`>` used instead of `>=` in two places), letting users claim COMP rewards they weren't entitled to. No admin controls or kill-switch existed to halt distribution; any remediation required a new 7-day governance cycle.
- **Governance primitives involved:**
  - Compound Governor Bravo — OZ-lineage propose/vote/queue/execute flow with a 2-day timelock.
  - Comptroller is an upgradeable-by-governance contract — upgrades go through the same propose+vote+timelock path as parameter changes.
- **Pre-incident visible signals:**
  - (i) The new Comptroller implementation bytecode was published when Proposal 62 was queued — visible on Etherscan during the 2-day timelock window.
  - (ii) The protocol had no admin-callable pause / kill-switch on COMP distribution — structurally detectable from Comptroller ABI (no `pauseRewards()` equivalent).
  - (iii) Post-execution: anomalous `claim` volumes in the first blocks after upgrade were detectable via event analytics.
- **Detector coverage:**
  - **Would not catch directly** — this was a subtle `>=` vs `>` bug, below symbolic-execution or formal-verification detection thresholds for a lightweight scanner.
  - **Would catch adjacent signal:** GOV-006 (upgradeable implementation with no emergency pause) — flags the class of contract that can't be halted without a new governance cycle, which turns any bug into a multi-day exposure.
  - **Would catch adjacent signal:** GOV-007 (implementation unverified at time of upgrade queue) — if the queued impl is unverified on Etherscan, user review is impossible before execution. Not the exact failure mode here (Compound verified the impl), but same class.
- **References:**
  - [The Block — $80M at risk](https://www.theblock.co/linked/119086/compound-bug-comp-risk-misreward)
  - [CryptoSlate — Tiniest of errors](https://cryptoslate.com/how-the-tiniest-of-errors-resulted-in-an-80-million-loss-for-compound-finance/)
  - [Benzinga — Smart contract bug](https://www.benzinga.com/markets/cryptocurrency/21/09/23178547/defi-protocol-compound-finance-accidentally-rewards-users-with-80m-in-tokens-due-to-smart-)

---

## Incident 4 — Ronin Bridge (March 23, 2022, ~$625M, Ronin / Ethereum withdrawal side)

- **Chain:** Ronin Network (withdrawal-destination side on Ethereum)
- **Loss:** ~$625M (173,600 ETH + 25.5M USDC)
- **Attack vector:** Per Halborn, the attacker "used hacked private keys in order to forge fake withdrawals" from the bridge. Ronin used a 5-of-9 validator multisig; Sky Mavis directly controlled 4 validator keys, and Sky Mavis also retained signing authority over the Axie DAO validator key (a temporary November 2021 allowlist delegation that was never revoked). Combining 4 + 1 = 5 signatures, the attacker cleared the withdrawal threshold. A gas-free RPC node was abused to obtain the fifth signature remotely. Hack undetected for 6 days.
- **Governance primitives involved:**
  - Custom 5-of-9 validator multisig on the bridge contract (not a Gnosis Safe).
  - No on-chain timelock on withdrawal approvals — signature-based immediate settlement.
  - Operational governance (the allowlist delegation) tracked off-chain in Sky Mavis operations.
- **Pre-incident visible signals:**
  - (i) Validator signer-set composition was publicly readable — 4 of 9 keys controlled by one entity (Sky Mavis) is a single point of failure detectable via signer-clustering heuristics (address funding graph, transaction co-submission patterns).
  - (ii) The Axie DAO allowlist delegation was a 2021 on-chain change never followed by a revocation — detectable as "stale delegated authority" via change-log inspection if the allowlist is on-chain; unfortunately in this case the allowlist was partly operational.
  - (iii) No pre-withdrawal on-chain signal existed for the specific exploit — it executed as a single set of valid signatures.
- **Detector coverage:**
  - **Would catch:** GOV-003 (multisig signer concentration) — a clustering detector that resolves signer EOAs to funding sources would flag 5-of-9 where a single entity funds 5 keys.
  - **Would not catch:** operational key-management failures (compromised infrastructure) are off-chain.
- **References:**
  - [Halborn — Explained: The Ronin Hack](https://www.halborn.com/blog/post/explained-the-ronin-hack-march-2022)
  - [CoinDesk — $625M exploit](https://www.coindesk.com/tech/2022/03/29/axie-infinitys-ronin-network-suffers-625m-exploit)
  - [Coinbase Bytes — Behind the hack](https://www.coinbase.com/bytes/archive/axie-infinity-625-million-dollar-hack-explained)

---

## Incident 5 — Audius (July 23, 2022, ~$6M proceeds / 18M AUDIO stolen, Ethereum)

- **Chain:** Ethereum mainnet
- **Loss:** 18M AUDIO tokens (~$6M at exploit time; $1.08M realised after Uniswap sale)
- **Attack vector:** Storage-slot collision in the `AudiusAdminUpgradabilityProxy` pattern. The proxy stored the `proxyAdmin` address in storage slot 0. OpenZeppelin's `Initializable` base contract stores the `initialized` and `initializing` booleans in slot 0. Because the deployed `proxyAdmin` address ended in byte `0xac`, the slot was interpreted as `initialized = true` by the proxy but as a re-callable `initialize()` by the implementation. The attacker called `initialize()` again on the governance + staking + delegation contracts, elected themselves admin, passed a malicious governance proposal, and transferred 18M AUDIO from the community treasury.
- **Governance primitives involved:**
  - Custom proxy upgrade pattern (not stock OZ TransparentUpgradeableProxy — OZ's standard puts admin in slot `0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103`, not slot 0).
  - Custom governance contract with Audius's own stake-weighted voting.
  - Contracts had prior audits (OpenZeppelin 2020, Kudelski 2021) — the collision survived both.
- **Pre-incident visible signals:**
  - (i) Non-standard proxy admin slot is detectable by probing standard EIP-1967 slots and comparing to contract storage layout. If a contract uses slot 0 for admin instead of EIP-1967's admin slot, that's a red flag pattern.
  - (ii) Proxy's implementation contract includes `Initializable` — visible from source verification. Storage-layout analysis (Slither, surya) can flag slot-0 collisions between proxy and implementation.
  - (iii) The `proxyAdmin` address ending in a non-zero byte is a latent condition; detection requires storage-layout + address-byte analysis combined, which is feasible but non-trivial.
- **Detector coverage:**
  - **Would catch:** GOV-005 (proxy admin slot non-standard / not at EIP-1967 slot) — detects the class of custom proxy patterns that bypass EIP-1967 conventions.
  - **Would catch partially:** GOV-006 (proxy implementation review flags) — Slither-style storage-collision detection requires implementation source + slot-layout analysis; candidate for Plan 03+.
  - **Would not catch:** Subtle byte-level collisions without a storage-layout analyzer in the scanner pipeline.
- **References:**
  - [Bitdefender — Audius exploit](https://www.bitdefender.com/en-us/blog/hotforsecurity/hacker-exploits-bug-at-decentralized-music-platform-audius-steals-6-million-worth-of-tokens)
  - [Callisto Network — Exploit overview](https://docs.callisto.network/hack-investigation-dept./audius-governance-system-exploit-overview)
  - [CryptoSlate — Contract initialization bug](https://cryptoslate.com/attackers-stole-6-million-from-audius-by-exploiting-a-bug-in-the-contract/)
  - [GitHub — Audius exploit PoC (nukanoto)](https://github.com/nukanoto/audius-exploit)

---

## Detectable pattern summary

### Signals observed across multiple incidents

| Signal | Drift | Beanstalk | Compound 62 | Ronin | Audius | Count |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Missing, zero-delay, or bypassable timelock | ✅ | ✅ (bypassed) | ❌ (2d present) | n/a | ❌ | 2 |
| Governance-bypass or emergency-execute function in admin ABI | ✅ (direct admin) | ✅ (`emergencyCommit`) | ❌ | n/a | ✅ (re-`initialize`) | 3 |
| Multisig signer concentration / threshold risk | ✅ (2-of-5 + team) | n/a | n/a | ✅ (5-of-9, 5 controlled) | n/a | 2 |
| Flash-loan-vulnerable vote weighting (no snapshot) | n/a | ✅ | ❌ | n/a | ❌ | 1 |
| Proxy admin = EOA / non-timelock / non-standard slot | n/a | n/a | ❌ | n/a | ✅ | 1 |
| Upgradeable contract lacks emergency-pause / kill-switch | n/a | n/a | ✅ | n/a | ✅ | 2 |

### Highest-priority signals (≥2 incidents)

1. **Missing / bypassable timelock** — Drift (removed) + Beanstalk (bypassed). Directly testable via Governor/TimelockController read + static ABI scan for `emergency*` / `skipDelay` functions.
2. **Governance bypass functions** — Beanstalk, Audius re-init, Drift direct-admin path. Statically detectable from ABI pattern-matching.
3. **Multisig signer concentration / low threshold** — Drift + Ronin. Detectable via `getThreshold()` + `getOwners()` read plus signer-clustering heuristic on owner EOAs.
4. **Upgradeable without emergency pause** — Compound 62 + Audius. Detectable via ABI scan for absence of `pause()`/`emergencyStop()` on governance-upgradeable contracts.

### Lower-priority signals (1 incident but reproducible)

5. **Flash-loan-vulnerable vote weighting** — Beanstalk. Detectable by confirming Governor uses `ERC20Votes` (block-height snapshot) or equivalent; custom token-balance-at-call voting flagged.
6. **Proxy admin slot non-standard** — Audius. Detectable by probing EIP-1967 admin slot and comparing to actual storage layout.

### Signals we explicitly defer (out of Plan 02 scope)

- **Proposal simulation** (Beanstalk BIP-18, Compound Prop 62 drain detection) — requires fork-simulation infrastructure; Plan 03+.
- **Social engineering / off-chain key compromise** (Drift durable nonces, Ronin key theft) — non-observable from chain state.
- **Storage-layout collision detection at byte level** (Audius) — requires Slither/surya-grade analysis; Plan 03+.
- **Token-wash-trading / attribution signals** (Drift CVT) — non-scope, requires DEX analytics.

---

## Proposed detector inventory for Plan 02 §5.1

Six detectors, each anchored to at least one incident above. IDs are stable references for spec + code.

| ID | Title | Trigger | Severity baseline | Anchored incidents |
|---|---|---|---|---|
| **GOV-001** | Timelock missing or insufficient delay | Governor/TimelockController minDelay < 48h OR no timelock attached to upgrade/admin path | HIGH | Drift, Beanstalk (partial) |
| **GOV-002** | Governance bypass / emergency-execute function present | ABI includes `emergency*`, `skipTimelock`, `immediateExecute`, re-callable `initialize`, or equivalent | HIGH | Beanstalk, Audius, Drift |
| **GOV-003** | Multisig signer concentration or low threshold | `threshold / ownerCount < 0.5`, OR signer cluster analysis shows a single entity controls ≥ threshold owners | HIGH (CRITICAL if combined with missing timelock) | Drift, Ronin |
| **GOV-004** | Flash-loan-vulnerable vote weighting | Governor is not `ERC20Votes` / does not call `getPastVotes()` at a snapshot block height | CRITICAL | Beanstalk |
| **GOV-005** | Proxy admin misconfiguration | EIP-1967 admin slot resolves to EOA (not timelock), OR contract uses non-standard admin slot instead of EIP-1967 | HIGH | Audius |
| **GOV-006** | Upgradeable contract without emergency pause | Governance-upgradeable contract has no `pause()` / `emergencyStop()` / kill-switch on critical functions | MEDIUM | Compound 62, Audius |

### Coverage matrix (detector × incident)

| Detector | Drift | Beanstalk | Compound 62 | Ronin | Audius |
|---|:---:|:---:|:---:|:---:|:---:|
| GOV-001 | ✅ primary | ✅ partial | — | — | — |
| GOV-002 | ✅ | ✅ primary | — | — | ✅ |
| GOV-003 | ✅ | — | — | ✅ primary | — |
| GOV-004 | — | ✅ primary | — | — | — |
| GOV-005 | — | — | — | — | ✅ primary |
| GOV-006 | — | — | ✅ primary | — | ✅ secondary |

Every incident has ≥1 detector flagging a governance signal that was visible before exploitation (excluding off-chain key compromise and social-engineering vectors, which are explicitly out of scope).

### Fixture-testability

- **Beanstalk (GOV-002 + GOV-004):** Beanstalk Diamond contract state is still readable at historical block heights; a unit fixture can pin `emergencyCommit` presence and no-snapshot vote weighting.
- **Audius (GOV-005):** `AudiusAdminUpgradabilityProxy` state is readable; slot-0 vs EIP-1967-slot comparison is deterministic.
- **Ronin (GOV-003):** 5-of-9 bridge validator set is historically queryable.
- **Compound 62 (GOV-006):** Comptroller ABI at the time of Proposal 62 is queryable; absence of pause function is verifiable.
- **Drift (GOV-001, GOV-003):** Solana-side state is readable but Plan 02 is EVM-only, so this becomes a design-discussion fixture only — the pattern generalizes but the exact reproduction requires Plan 03+ Solana support.

### Open questions for Plan 02 spec authoring

1. **Severity baselines** — should GOV-001 (missing timelock) escalate to CRITICAL when combined with GOV-003 (concentrated multisig)? Multi-signal composition logic needs spec.
2. **Detector versioning** — how does Breakwater handle a protocol that adds a timelock post-scan (our false-positive becomes stale)? Re-scan cadence TBD.
3. **Public title vs evidence** — GOV-004's "flash-loan-vulnerable vote weighting" needs careful public phrasing to avoid teaching an attacker. Use generic hint for unauth tier, specific detail for email tier.
4. **ERC20Votes / ERC721Votes coverage** — user confirmed in scope but no incident above stressed it directly. GOV-004 is the closest match; consider GOV-004a for delegation-related edge cases if research surfaces another case.
5. **Proxy pattern coverage** — EIP-1967, EIP-1822 (UUPS), transparent proxy all in scope. Audius covers non-standard; we have no direct UUPS incident in this sample. Plan 02 may want to lean on OWASP/OpenZeppelin general proxy best-practices for UUPS coverage.

---

## Sources consulted

Primary:

- [Chainalysis — Lessons from the Drift hack](https://www.chainalysis.com/blog/lessons-from-the-drift-hack/)
- [TRM Labs — North Korean hackers attack Drift](https://www.trmlabs.com/resources/blog/north-korean-hackers-attack-drift-protocol-in-285-million-heist)
- [The Hacker News — Six-month DPRK operation](https://thehackernews.com/2026/04/285-million-drift-hack-traced-to-six.html)
- [CertiK — Revisiting Beanstalk Farms Exploit](https://www.certik.com/resources/blog/6HaLMGIL5sI2fpfEZc0nzS-revisiting-beanstalk-farms-exploit)
- [Halborn — Explained: The Ronin Hack](https://www.halborn.com/blog/post/explained-the-ronin-hack-march-2022)
- [Bitdefender — Audius exploit](https://www.bitdefender.com/en-us/blog/hotforsecurity/hacker-exploits-bug-at-decentralized-music-platform-audius-steals-6-million-worth-of-tokens)

Secondary:

- [Cointelegraph — Beanstalk DeFi governance exploit](https://cointelegraph.com/news/beanstalk-farms-loses-182m-in-defi-governance-exploit)
- [CoinDesk — Beanstalk $182M](https://www.coindesk.com/tech/2022/04/17/attacker-drains-182m-from-beanstalk-stablecoin-protocol)
- [Omniscia post-mortem (via Coinmonks)](https://medium.com/coinmonks/beanstalk-exploit-a-simplified-post-mortem-analysis-92e6cdb17ace)
- [The Block — Compound $80M at risk](https://www.theblock.co/linked/119086/compound-bug-comp-risk-misreward)
- [CryptoSlate — Compound tiniest of errors](https://cryptoslate.com/how-the-tiniest-of-errors-resulted-in-an-80-million-loss-for-compound-finance/)
- [CoinDesk — Ronin $625M exploit](https://www.coindesk.com/tech/2022/03/29/axie-infinitys-ronin-network-suffers-625m-exploit)
- [Coinbase Bytes — Behind Ronin hack](https://www.coinbase.com/bytes/archive/axie-infinity-625-million-dollar-hack-explained)
- [Callisto Network — Audius exploit overview](https://docs.callisto.network/hack-investigation-dept./audius-governance-system-exploit-overview)
- [CryptoSlate — Audius contract init bug](https://cryptoslate.com/attackers-stole-6-million-from-audius-by-exploiting-a-bug-in-the-contract/)
- [GitHub — Audius exploit PoC (nukanoto)](https://github.com/nukanoto/audius-exploit)
