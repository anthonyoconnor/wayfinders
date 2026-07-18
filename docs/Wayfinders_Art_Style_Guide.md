# Wayfinders art style guide

This document owns the shared visual direction for player-facing artwork and
interface presentation in Wayfinders. It is written for agents and artists who
create or revise world assets, illustrations, icons, animation, and game UI.

Treat it as a compass, not a construction kit. It describes the qualities that
make new work feel related without requiring every screen to use the same
palette, ornament, material, or mood. A coherent experiment is preferable to a
literal imitation that does not serve its context.

This guide does not define gameplay facts, collision, runtime asset formats, or
feature-specific symbol meanings. Those remain owned by the
[technical design](Wayfinders_Technical_Design.md),
[asset pipeline](Wayfinders_Asset_Pipeline.md), and specialist documents such
as the [Great Hall infographic lexicon](Wayfinders_Great_Hall_Infographic_Lexicon.md)
and [water-system design](Wayfinders_Water_System_Milestone.md).

## How to interpret the guide

The owning feature contract determines what a visual means. The current art
brief determines the mood and flavor that best express it. Target-size
readability, accessible state communication, cultural respect, protection
against hidden-information leaks, and the approved technical delivery contract
are hard boundaries.
Palette, material, composition, texture, and mood suggestions elsewhere in this
guide are prompts, not requirements.

For a new visual family, consequential screen, or deliberate stylistic
departure, a compact working brief is useful:

- **Purpose:** what job the visual performs and what it must communicate.
- **Context:** where it appears, what surrounds it, and its smallest real
  viewing size.
- **Truth owner:** which gameplay, feature, or symbol contract supplies its
  meaning.
- **Inherited anchors:** the shapes, palette relationships, materials, or
  hierarchy it shares with nearby work.
- **Chosen flavor:** the mood or treatment this piece is free to explore.
- **Deliberate departures:** what changes from the nearest precedent and why.
- **Review views:** target-size context, grayscale, static or reduced motion,
  and any responsive states that change the composition.

Routine revisions do not need a ceremonial brief. They still need to be judged
in their real context.

## The visual promise

Wayfinders is a living tropical archipelago understood through the practical
craft of people who read the sea, make voyages, and preserve what they learn.
The world should feel handmade, observant, warm at home, and invitingly
uncertain at its edges.

- The sea is spacious and comparatively quiet; islands and discoveries carry
  the denser detail and stronger silhouettes.
- Home feels inhabited and made: timber, fiber, rope, stone, shell, pigment,
  firelight, and signs of repeated use.
- Navigation information feels charted, tied, carved, painted, inlaid, or
  remembered rather than added as generic game chrome.
- Wonder appears through restrained contrast, motion, and discovery. It does
  not require every edge to glow or every surface to move.
- The interface and the world may use different levels of detail, but they
  should feel as though they belong to the same people and place.

The desired response is not "this follows a template." It is "this could only
belong to Wayfinders."

## What holds the style together

### Readability before decoration

Start with the silhouette, value grouping, and focal hierarchy. Texture and
ornament can reward a closer look, but they should not be required to identify
an island, vessel, landmark, state, or action.

Aim for a clear order of attention:

1. the current place, subject, or decision;
2. the information needed to act;
3. supporting atmosphere and material detail.

Large quiet regions are useful. They make islands feel rich, keep interfaces
legible, and give rare highlights somewhere to matter. Avoid distributing the
same contrast and detail density across every part of a composition.

### A coastal craft language

The established material family includes warm timber, woven fiber and
sailcloth, rope and lashings, shell or pale inlay, weathered pigment, basalt,
ochre sand, rust-colored roofs and metals, and turquoise-stained details. These
are ingredients, not a checklist. A screen usually needs only a small, coherent
subset.

Materials should suggest how something is made. A rope line joins, binds, or
measures; an inlay marks something valued; a timber edge frames or carries
weight; woven cloth spans a panel; patina records age. Avoid applying texture as
surface noise with no structural purpose.

New materials and motifs are welcome when they suit the archipelago and are
introduced with intent. Repeat a new idea enough to establish a local grammar,
or keep it rare enough to read as a deliberate focal exception.

Use an invented Wayfinders vocabulary drawn from sea travel, canoe
construction, weaving, islands, currents, wakes, lagoons, fish, shells, stars,
and practical navigation marks. Do not directly copy an identifiable
real-world sacred, ceremonial, or culturally restricted motif. Avoid generic
"tropical" caricature and decorative cultural pastiche.

### Palette by role, not by formula

The project has a recognizable warm-cool relationship, but no single swatch
list needs to govern every biome, hour, or interface.

- Navy, deep teal, and charcoal commonly create distance, water depth, shadow,
  and quiet recesses.
- Turquoise and seafoam connect naturally to coast, water, and continuity.
- Sand, sailcloth, and shell-ivory provide readable grounds and calm highlights.
- Timber, rust, ochre, and warm earth make home, history, and built structure
  feel tangible.
- Amber, vermilion, and rich shell gold make effective focal accents when used
  selectively.

A palette may shift substantially for moonlight, weather, geology, ceremony,
or a new island family. Preserve intentional relationships such as quiet versus
focal, foreground versus distance, common versus rare, and actionable versus
ambient; any suitable hue family may create them. Feature-specific documents
own reserved semantic colors and tighter palette handoffs. Do not infer a
global state meaning from the palette tendencies in this guide.

### Shape, texture, and light

World geometry tends toward organic, broken contours: scalloped shores,
clustered foliage, interrupted foam, short wavelets, irregular reef shadows,
and paths that feel worn rather than plotted. Built forms can be more ordered,
but slight asymmetry, joinery, wear, and hand-laid repetition keep them human.

Prefer clustered marks and purposeful gaps over uninterrupted stripes, perfect
checkerboards, or evenly scattered noise. Variation should support a larger
form rather than dissolve it.

Keep lighting internally coherent and compatible with the immediate neighboring
art. The top-down world needs terrain-readable edges even when weather or time
of day changes the light. Portraits, interiors, and ceremonial art may use
richer modeling and a more illustrative finish, but their light and material
response should still relate to the world. Use bloom, cyan shimmer, and
sparkling highlights sparingly enough that the meaningful focal point remains
brightest.

### People and inhabited places

People should feel specific, dignified, and at home in the setting rather than
assembled from generic fantasy classes. Explore varied ages, features, skin
tones, hair textures, builds, expressions, clothing cuts, and degrees of wear.
Keep clothing and adornment practical or ceremonial within the invented
maritime material language; avoid exoticizing costume collage.

Visual individuality is welcome, but it does not create gameplay biography.
Do not use appearance to imply a name, role, trait, relationship, culture, or
life history that the owning feature does not supply.

## Match the treatment to the viewing scale

Wayfinders does not need one rendering treatment at every size. Cohesion comes
from shared hierarchy, shapes, materials, and palette roles, not from shrinking
one detailed image into every context.

### World scale

Top-down runtime assets favor crisp, dense-but-readable pixel clusters,
recognizable footprints, and small high-contrast silhouettes. Water and ground
support landmarks rather than competing with them. Perspective, lighting,
edge treatment, and apparent pixel density should agree with neighboring world
assets. Preview true pixel art with its intended nearest-neighbor scaling;
choose smoother interpolation only for a deliberately illustrative tier.

### Compact interface scale

Icons and state marks have a very small semantic pixel budget at their smallest
real display size. Design or retouch them at that size. Strengthen the central
noun, simplify the frame, protect deliberate gaps, and remove detail that
becomes flicker or mud. A large source asset is not evidence that its downscaled
version works.

Related compact symbols should be distinguishable in a representative static
frame, in grayscale, and without relying on a tiny interior accent. If an
ornate large token and a compact Hall symbol need different art tiers, make
different tiers rather than forcing one compromise onto both.

### Display and ceremonial scale

Portraits, backdrops, selected memorials, and asset-workspace previews may use
more painterly shading, texture, ornament, and facial detail. Retain decisive
value groups and clean edges so the work still sits comfortably beside the
pixel world and scales down gracefully in layout.

Different fidelity tiers may have different flavors. They should share a
family resemblance, not identical brushwork.

## Interface direction

Player-facing UI is diegetic-adjacent: clear screen-space interface behavior
expressed through the material and information language of the world. It does
not need to pretend that every control is a literal physical object.

- Keep the main action and current state easy to scan. Use ornament to frame
  hierarchy, not to give every panel equal importance.
- Build a small material family for each surface. Timber, woven panels, rope
  joins, shell inlay, chart marks, and oxidized edges can harmonize a screen,
  but using all of them at once usually weakens it.
- Let component shape suggest purpose: a tied cord can show sequence, a plaque
  can hold exact detail, a chart line can show relation, and a socket can show
  an available or completed place.
- Keep essential labels and values as semantic HTML or live text. Do not bake
  player-facing instructions, changing values, or required explanations into
  raster art.
- Favor sturdy, readable type at its real size. Short display headings may
  carry a carved, painted, or handmade flavor; actions, body copy, and exact
  detail prioritize clarity. Avoid tiny ornamental lettering.
- Preserve clear focus, hover, active, disabled, selected, and danger states.
  Artwork may enrich them, but the interaction state must remain legible
  through contrast, shape, placement, and accessible text.
- Treat artwork and hit areas separately when necessary. A delicate symbol can
  sit inside a comfortably sized control.
- Reflow the composition at narrow sizes instead of shrinking an entire rich
  interface until its symbols and text become unreadable.

Developer tools may remain more utilitarian than the player experience. When a
tool previews player-facing work, the preview itself should use the real asset,
scale, animation, and surrounding context whenever practical.

## Symbols and visual state

Reuse established semantic silhouettes when representing an existing game
concept. Feature documents own exact mappings; the style guide does not grant
permission to rename, merge, or infer gameplay facts from artwork.

Related states benefit from a learnable transformation of the same base form:

- outline to inlay or fill;
- open to closed;
- whole to broken;
- weathered crack to visible repair;
- quiet socket to occupied or completed socket.

Color can reinforce these changes but must not be the only carrier. Important
states should remain understandable in grayscale, reduced saturation, and
common color-vision conditions. Exact labels remain available for compact or
unfamiliar marks.

Do not use pixels to imply knowledge the player does not have. Unknown quality,
hidden identity, unrecovered history, and unavailable actions should not leak
through a brighter variant, richer animation, or suggestive decoration.

## Motion

Motion should reveal character or meaning before it adds spectacle. Useful
sources include current flow, wake travel, breathing ripples, wind through
foliage, firelight, a settling knot, a charting gesture, or a rare shell glint.
Generic spinning, pulsing, and perimeter shimmer are weaker defaults.

- Keep the base plane stable and animate selective accents.
- Concentrate motion near the information or subject it explains.
- Avoid making many neighboring elements peak in perfect synchronization.
- At compact sizes, prefer held key poses and a calm apparent cadence over
  fine subpixel travel that reads as flicker.
- Make the first or designated static frame useful on its own.
- Provide an intentional reduced-motion presentation. Pausing animation should
  preserve meaning and composition.
- Loops should settle naturally and avoid a conspicuous final-to-first jump.

Not every polished asset needs animation. Stillness is part of the project's
rhythm.

## Space for experimentation

The shared style should support different moods rather than flattening them.
Agents are encouraged to explore:

- time of day, weather, visibility, and sea state;
- island geology, ecology, age, and patterns of habitation;
- brighter chart-room, weathered field-kit, woven chronicle, memorial, or
  moonlit interface flavors;
- crisp, graphic, painterly, carved, stitched, or inlaid treatments at the
  fidelity tier where each works;
- unusual natural, bioluminescent, or ceremonial light when it has a clear
  scene or navigation purpose; supernatural effects only when the owning brief
  establishes them; and
- different rhythms of motion, asymmetry, wear, and repair.

For a consequential experiment, write a one-sentence visual thesis. Name the
project anchors it keeps and the one or two dimensions it changes. For example,
a moonlit scene may move the sea toward indigo and cyan while keeping
navigation sparse and silhouettes clear. A volcanic island may exchange lush
greens for basalt and dry scrub while preserving the coastal handoff and
readable top-down footprint.

Experimentation becomes incoherence when several loud departures compete
without a shared reason. If a deliberate departure improves the scene, show it
in context and explain the tradeoff rather than sanding it away merely because
it is new.

For generated or externally sourced imagery, treat the first output as source
material, not a finished runtime asset. Remove accidental text, watermarks,
fringing, inconsistent light, perspective errors, over-smoothed edges, and
details that collapse at the target scale. Preserve source provenance and use
the repository's approved asset workflow.

## Review questions

An asset or screen is ready for visual approval when the answers are strong:

- Does the important subject read immediately at the real target size?
- Does the composition have a clear focal order and enough quiet space?
- Do its materials and palette roles feel related to Wayfinders without merely
  tracing an existing asset?
- Are new flavors deliberate and internally consistent?
- Do paired symbols and interaction states survive grayscale and still frames?
- Does motion clarify meaning, preserve reduced motion, and avoid collective
  shimmer?
- Does the UI remain readable, focusable, and useful at supported layouts?
- Does the art avoid inventing gameplay truth or exposing hidden information?
- Does it use an invented coastal vocabulary without copying a real sacred or
  restricted motif?
- Has it been reviewed in the actual water, fog, knowledge, risk, cloud, and UI
  stack that can surround it, rather than only on an isolated source canvas?

Technical validation and visual approval are separate. Passing the asset check
does not prove the art is legible or cohesive; a beautiful preview does not
prove the runtime file contract is valid.

## Current references, not mandatory templates

Use approved runtime work to understand relationships and context, then make
the choice that best serves the new asset.

### Runtime and approved anchors

- `public/assets/gr1/images/home-island.png` is the main world-scale anchor for
  top-down density, tropical color, shoreline shape, and built detail.
- `public/assets/gr1/water` contains the current water, shoreline, overlay, and
  shoal art used beside authored islands.
- `public/assets/gr5/great-hall/hall-interior-backdrop.png`,
  `public/assets/gr5/great-hall/portraits`, and
  `public/assets/gr5/great-hall/achievement-token-set.png` show the more
  illustrative Hall tier and its timber, woven, shell, teal, and warm-light
  material family.
- `public/assets/gr5/achievement-icons/achievement-icon-sprites.png` shows the
  current animated achievement vocabulary. Review its compact runtime use at
  target size rather than treating source-scale detail as automatically
  transferable.

### Supporting studies

- The [visual-direction studies](../concept_art/style-guide/README.md) preserve
  generated cohesion examples, alternative flavors, and comparison boards.
  They demonstrate range rather than mandate a production look.
- `assets-src/gr1/water/runtime/water-home-island-preview.png` is retained
  inspection evidence for the island-water handoff, not a shipped runtime
  asset.
- `concept_art/great-hall` contains composition and mood references. Concept
  art is inspiration and decision history, never an automatic runtime or
  project-wide style mandate.

Procedural developer markers, the generic asset-tool shell, magenta-backed
source examples, and unpromoted concept sheets are not project-wide visual
authority.

Current art is evidence of the visual language, not the boundary of what the
game is allowed to become.
