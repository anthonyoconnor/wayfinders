# Wayfinders future world-activity and economy design

This document owns product direction for possible world-activity expansion. It
does not describe current runtime contracts or authorize work.

Current surveying, provisions, lineage, Great Hall, idol-location, and
completion behavior is documented in `Wayfinders_Technical_Design.md`. The
roadmap owns whether any idea below becomes a milestone.

## Purpose

Future world activity should make returned knowledge and generational change
feel consequential without turning Wayfinders into an economy simulator by
default. Add authority only when playtesting identifies a player decision that
the existing sail, survey, return, and inherit loop cannot provide.

## Design principles

- Start with sparse presentation derived from returned records and Supported
  water before adding mutable economic state.
- Keep Unknown and Personal routes private. Traffic must never reveal or imply a
  route the home community does not know.
- Preserve exact-dock commitment: provisional findings do not affect permanent
  world activity.
- Let communities, sites, and routes retain stable semantic identity across
  presentation layers.
- Prefer one visible player decision over background counters, timers, or
  simulation that cannot be acted upon.
- Keep generation and authoritative gameplay deterministic and headless-testable.

## Presentation-first activity

Returned knowledge can support inexpensive signs of a living world:

- fishing skiffs near returned shoal reports;
- community boats near known island approaches;
- sparse trade vessels following Supported connections;
- changed harbour activity after major returned discoveries; and
- handover or Great Hall presentation derived from the lineage record.

These are presentation read models unless a later design gives them explicit
gameplay consequences. They need no inventories, autonomous route planning,
collision, market prices, or persisted timers.

## Possible authoritative expansion

If playtesting shows a concrete need, a future milestone may introduce one
bounded decision such as choosing which known community to support, allocating a
limited voyage loadout, or selecting one route benefit. Such a milestone must
define:

1. the player decision and why current provisions/surveys do not provide it;
2. the minimum authoritative state needed for that decision;
3. how exact-dock return, wreck rollback, and succession order the change;
4. what is derived presentation versus gameplay authority;
5. deterministic identity and bounded update costs; and
6. focused acceptance evidence before broader simulation is considered.

Do not infer a generic resource catalog, dynamic pricing, labour allocation,
fleet management, automatic trade, or idle progression from a smaller feature.
Those systems require separate product justification and authorization.

## Community boundary

An island dossier may describe a living community without simulating its needs,
surplus, output, or politics. **Community** covers remote settlements and broad
fiction. **Tribe** refers specifically to authoritative home-community support
state. A future contract must choose the correct term and cannot silently turn
descriptive dossier text into economy authority.

## Product and playtest questions

- Does the current survey cost create a meaningful survey-versus-range choice?
- What warning language communicates tight return risk without making the
  decision for the player?
- Are world marks and the Great Hall enough for returned leads, or is a compact
  log needed?
- Which returned findings create the clearest presentation changes?
- Would one bounded support or loadout decision deepen voyages, or merely add
  administration?
- How should activity remain legible with hundreds of islands without spawning
  or updating hundreds of actors?
- What visual treatment distinguishes an idol-location finding without implying
  that the physical idol was recovered?

## Explicit non-goals

Until a roadmap milestone says otherwise, this direction does not include
markets, arbitrage, real-time refill timers, automatic trade, combat, escorts,
NPC collision, direct fleet commands, family trees, inheritable traits,
politics, illness, age simulation, generic cargo, or physical idol recovery.
