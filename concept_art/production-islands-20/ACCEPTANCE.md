# Production island runtime acceptance

Accepted on 2026-07-19 against the selected concepts and production sources
retained beside this record.

## Review method

Each imported island began unavailable with the intake-generated conservative
collision seed. Its complete `32`/`8` semantic mask was then manually refined
to the selected geography and saved through the focused Islands transaction.
The isolated sea trial loaded the actual prepared composite and exact saved
mask at the trial fingerprint listed below. Navigation-grid and collision
overlays remained visible while all four hull-safe reset directions and sailing
input were exercised.

The comparison checked that solid cells follow visible land and structures,
water aprons remain passable, intended lagoons, channels, coves, harbors, and
fjords remain open, and detached reef, rock, and ice dressing does not become
offshore collision. It also checked the selected silhouette, habitation read,
deep-water edge blend, absence of matte contamination or hard rectangular
edges, and readability at game zoom. No post-trial geometry correction was
required after the manual mask pass.

After the isolated trial passed, the same rollback-safe **Save changes**
transaction enabled the island. That availability-only save produced the
runtime fingerprint listed below without changing its prepared art or authored
collision. Live P0 worlds were then reviewed with navigation and collision
overlays in the normal fog, water, cloud, knowledge, risk, ship, and HUD
context. Each listed dossier approach completed successfully, displayed the
authored composite rather than fallback art, and kept the collision overlay
aligned. The browser console remained free of warnings, loading failures, and
fallback errors.

The primary seeds `940`, `200`, `199`, `1359`, and `17` cover all twenty stable
IDs. Seed `1359` also places the existing Crescent Cay between the new Saltbone
and Three-Fin entries. Seed `11387` supplies clearer non-seam review frames for
Saffron Haven and Emberhearth Isle; both also placed in the primary seed `940`.

The repository-I/O acceptance test supplements the visual review by exercising
the exact current candidates across all eighty island/reset-direction pairs. It
checks hull-safe spawns and runtime-collision reachability to a shoreline
approach on every corresponding side.

## Accepted revisions and live placements

`Trial` is the exact unavailable revision reviewed in the isolated sea trial.
`Runtime` is the availability-save revision used by generated worlds.

| Biome | Island | Brief | Trial | Runtime | Live P0 evidence |
| --- | --- | --- | --- | --- | --- |
| Tropical | Sunweave Lagoon | Inhabited · left | `d24db954e7bbd7c3c7eeeee3cbbf28643106ed76c9938da06f8bc02b79e8fef5` | `abbf151d03ee1364f1b3ace8f06c258c36eaa5cd295c7c7374cfc1890197563a` | seed `199`, island `8`, Salt Cay |
| Tropical | Mangrove Forks | Inhabited · left | `29d67e5dfe0b27ee1cd8a105104ea24450646da126988bd6b3845e10c0fd0b7b` | `4cfcdc46eda6c57fa5b2aa7d9854669204dc2fda16d62a2fc3b28902011cafe7` | seed `199`, island `7`, Moon Rook |
| Tropical | Moonhook Cay | Uninhabited · left | `4f32fd69caca2ace6fc9fb2658b7ef4628124880d1ae4ae774d9b90a7deeebbd` | `578b803a108be07fe3211b224652a8fc2c3c73a692fd7353215f6fdf09ce4cc6` | seed `940`, island `7`, North Crown |
| Tropical | Three-Fin Atoll | Uninhabited · left | `ce8884aaca938604010038e0276457a69b604f87a5eea08a43baadc65a1251c4` | `eb10cf2bed07d63636734e636f827011b3d8258be28af201a965f0e82a5235c1` | seed `1359`, island `5`, Moon Mere |
| Desert | Saffron Haven | Inhabited · left | `b88ebf9d6a03bd1b794dbcc43128b9f38c8509404afcdff3556837c22ee37fac` | `a0078c0db087ee557c633618050678b9ae985c795af372cc50c3f47ace5ff0c4` | seed `11387`, island `4`, Salt Haven |
| Desert | Copperwind Port | Inhabited · left | `ae4e1597b1b0fb80076af6e7d3c040e5e45c132f83a19dab2be7156726ce899a` | `1e968a25112ce892fda3459d440a4b7946eb46e307044344641a06169ec021b6` | seed `940`, island `2`, Star Cay |
| Desert | Glass Dune Isle | Uninhabited · right | `f0dc9dfdfdf794965d71c3b36595ccc79553baf112d03986a661281bd8c948dd` | `4fbb9b9cd5ca65e42f1eb42301e23e4e0764ca9777bad55b12428ea632fffc5d` | seed `200`, island `3`, Bracken Crown |
| Desert | Scorpion Mesa | Uninhabited · left | `45b92fcfb210afda88032085d20c379921e58d60d596d6f341e14db3241b624d` | `88fc98bb95b0ba260cff835825b5acf836b99f9ad02b35cab12dc542789f3536` | seed `940`, island `5`, Salt Sound |
| Forest | Cedar Crown | Inhabited · right | `f08c827755eb4bd538dce62b1f05f0b7f43c42826aafd9ccff45c9371a701210` | `0eefa4f20cc0d2e0f4cc34ae3f3579152a0164742b22ae8db77145c2a31fd473` | seed `200`, island `4`, Blue Cairn |
| Forest | Mosswater Reach | Inhabited · left | `1c3d500d71f9580a95293d6968ead78c71f4b0e16dae7c45f6c6abd5a384ab04` | `f1568e3f8f6f589f9205e0878c2220d3931e38f05f7e982ed7d20f437a59ac9e` | seed `200`, island `5`, Bracken Reach |
| Forest | Splitpine Wilds | Uninhabited · right | `b81421e4cb486ba60c032b03c4f970f09fa07dbc8f825c4f199a265a3e989d98` | `65f0f28ffa3a3b7f231da355f3c35e40d30e6cd05bf199c7c95daafca0fb1ea1` | seed `199`, island `3`, Moon Spire |
| Forest | Ferncoil Isle | Uninhabited · right | `25583c48d2e821a554408d62944421761774d4e0a962d08786dd7133f004505a` | `1a24207e423f6992b52adc317632f2f0035960c78b9f8bd3039aa0ed4c5f5f50` | seed `199`, island `2`, Cloud Reach |
| Winter | Frostharbor | Inhabited · right | `b921ba5c525c714070a277d343d20c8d46753196b78ccd6907cc3ff6a3f8760d` | `24b71cb467f12f1543dcedb18db7cf1c31776ab11cb4e6f665ac2343dcbbd7e3` | seed `1359`, island `7`, Star Mere |
| Winter | Emberhearth Isle | Inhabited · right | `b8b19683974c46f3eb8eb5dfcc50254465cdf1a7750003684f0a09e5a5224a7e` | `8f066fc2b4038c39545077d6b53166345e33fa504fa8b2a6c99c2c535a44cf0f` | seed `11387`, island `7`, North Cay |
| Winter | Whitefang Skerry | Uninhabited · left | `0d757706d870af22d9d6058763e5e0c3c0c33da08442a389b07e996b8b75c972` | `851d33f256395b2232947da7e0b3d6d3957c82743d7005be4e1566dea6a91efa` | seed `17`, island `8`, Copper Lantern |
| Winter | Blueglass Atoll | Uninhabited · left | `74b434af5a850e131826b01a1f3adb646b822f2156a8d0d806fee84a51faa176` | `783362fe0567883d2a4b972a2d0ff3b38c7b9fb598ac4f4846e32eb2e7652bc6` | seed `1359`, island `6`, Green Watch |
| Barren | Cinder Crown | Uninhabited · volcanic · left | `6e182d4447e1f7798b705999d8a5aeaff5a179057b8eda8a30935ebd3708c8be` | `6bc00b77db5f5a6d5a42e7f33f0c3d00f58e6f4712df57d66ef9df83d6f1eda2` | seed `200`, island `2`, North Crown |
| Barren | Ashen Hook | Uninhabited · volcanic · left | `db16055153e9848db46d9ebcc2488410de4e03c9de8b8d88ecfc96c7a426e442` | `fb7c86b10dde80eedaf32999934a41ed4242a4ac43f2d852a3ece9e70cefa032` | seed `200`, island `1`, Dawn Key |
| Barren | Saltbone Flats | Uninhabited · left | `c6b3a15d640845fede38d82ddf0776a1414170a8891a73ab7fdd3fe376c55bf0` | `35e5d0b4e690cb36fabb47e2abba63f85cfd5c0ac674a983506f04c2eb09dfc8` | seed `1359`, island `1`, Amber Crown |
| Barren | Blackneedle Isle | Uninhabited · right | `2ec1dfb3144c40247bd256d7b5e2c0086d4d57fb7fc520b4b130bca6781fd74f` | `bd084bc09dc6d9d1cdbb318c3ac11aee32346be3bb5307629081193beb3506d6` | seed `940`, island `1`, Copper Watch |

## Result

All twenty imported islands meet the authored-island runtime acceptance rule
and have `availableInGame: true`. The four non-barren sets each contain exactly
two inhabited and two uninhabited islands; the barren set is entirely
uninhabited and includes the two volcanic entries Cinder Crown and Ashen Hook.
