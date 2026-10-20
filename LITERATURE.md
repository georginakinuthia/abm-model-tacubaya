# ABM Literature Review & Implementation Notes

This document records the scientific literature informing the pedestrian ABM,
what we implemented from each source, what we chose not to implement and why,
and open questions for future calibration.

The model is a **layered pedestrian microsimulation** combining discrete route
choice, position-based following, momentum smoothing, density-dependent speed,
and velocity-space collision avoidance. It does not have a single canonical
name; the closest family label is _"MNL route choice with ORCA collision
avoidance"_ — a hybrid that pairs Antonini-style utility scoring with
van den Berg-style velocity-obstacle constraints.

---

## 1. Route Choice — Antonini, Bierlaire & Weber (2006)

**"Discrete choice models of pedestrian walking behavior"**
_Transportation Research Part B: Methodological, 40(8), 667–687_

### What the paper proposes

- Random utility maximization (RUM) framework for step-by-step pedestrian navigation
- Choice set: **33 alternatives** = 3 speed regimes × 11 angular directions
- Two behavioral regimes: unconstrained (free flow) vs constrained (interactions)
- Cross-Nested Logit (CNL) preferred; simpler MNL as tractable baseline

Utility function:

```
V_i = β_dist · d_dest(i) + β_angle · angle_dev(i) + β_density · ρ(i) + β_interact · interactions(i)
```

Key systematic components:

1. **Distance to destination** — progress toward goal (strongest driver)
2. **Angular deviation** — preference for directions close to current heading
3. **Local density** — avoidance of crowded directions
4. **Pedestrian interactions** — proximity effects, leader-follower
5. **Obstacle avoidance** — physical barriers

Choice probability (MNL case):

```
P(i) = exp(V_i / μ) / Σ_j exp(V_j / μ)
```

Calibrated on 36 pedestrians (1,424 observations) from Lausanne metro station video.

### What we implemented

- **MNL structure** over 8-connected Moore neighborhood (our grid equivalent of
  Antonini's 11 angular sectors)
- **Five utility components** with explicit β coefficients:
  - `β_dist` (2.0) — normalized distance gain toward destination
  - `β_align` (2.0) — heading alignment × per-agent straightness preference
  - `β_density` (−2.5) — opposition-weighted density (oncoming = 1.0, co-directional = 0.2)
  - `β_obstacle` (−2.0) — stall/structure proximity
  - `β_shade` (5.0) — shade preference when sunny & uncrowded (gated off at high density)
- **Per-agent heterogeneity** via taste variation on alignment (routeStraightness)
  and directional bias (routeBiasDx/Dy), scaled by behaviorDiversity
- **Stable Gumbel-like error** via FNV-1a hash (deterministic per agent-patch pair)
- **Temperature parameter** (μ = 1.0) controlling choice dispersion
- **Directional density lookahead** (15 patches ≈ 15 m) with opposition-weighting:
  oncoming agents contribute full weight (1.0), co-directional agents contribute
  a floor (0.2), producing lateral lane-formation incentives in the MNL scoring

### What we chose not to implement

- **Cross-Nested Logit (CNL)**: Adds correlation structure between alternatives
  along speed and direction dimensions. MNL captures the main effects; CNL would
  add complexity without calibration data to estimate the nesting parameters.
- **Speed choice in utility**: Antonini's 3 speed regimes (decelerate, maintain,
  accelerate) are handled separately via Weidmann speed-density and ORCA.
- **Leader-follower in MNL**: Antonini's constrained regime models following.
  We implement following as a separate position-based post-MNL step (see §5).

### Coefficient notes

Our β values are illustrative (not estimated from data):

| Coefficient          | Value | Rationale                                                  |
| -------------------- | ----- | ---------------------------------------------------------- |
| `β_dist = 2.0`       |       | Dominant term — normalized progress toward destination     |
| `β_align = 2.0`      |       | Effective weight = 2.0 × straightness (default 0.3)        |
| `β_density = −2.5`   |       | Opposition-weighted; oncoming agents 5× co-directional    |
| `β_obstacle = −2.0`  |       | Patch inside a stall gets full penalty, providing keep-clear margin|
| `β_shade = 5.0`      |       | Strong pull when sunny & uncrowded; zeroed at high density |

---

## 2. Collision Avoidance — van den Berg et al. (2011)

**"Reciprocal n-body collision avoidance"**
_Robotics Research, 70, 3–19_

### What the paper proposes

- ORCA (Optimal Reciprocal Collision Avoidance): each agent computes a set of
  velocity-space half-plane constraints from nearby agents
- Solves a 2D linear program to find the closest feasible velocity to the
  preferred velocity
- Guarantees collision-free motion if all agents follow the protocol
- Each agent takes half the avoidance responsibility (reciprocity)
- Key parameters: time horizon τ, agent radius r, neighbor distance

### What we implemented

Full ORCA solver in `src/models/orca.ts`:

- **Velocity obstacle (VO) construction**: Truncated cone for non-overlapping
  agents, dt-based escape for overlapping agents
- **Half-plane projection**: Both cut-off circle and cone leg cases
- **2D incremental linear program**: Feasible velocity search with speed-disc
  constraint
- **Fallback (LP3)**: When constraints are infeasible, minimizes maximum
  penetration depth
- **Head-on resolution**: Right-leg projection for near-head-on encounters
  (cross product below cone threshold), breaking symmetry without artificial bias
- **Spatial hash grid**: O(1) neighbor queries for efficient ORCA computation
- **Direct heading authority**: ORCA's output velocity is used directly as the
  agent's heading — no blending or attenuation. ORCA runs last in the pipeline
  so collision avoidance is never overridden.
- **Speed output**: `min(orcaSpeed, baseSpeed)` — ORCA can slow agents but
  not accelerate them
- **Engaged agent blending**: Engaged agents partially follow ORCA (30% blend)
  to preserve amenity-seeking behavior
- **Hard barrier enforcement**: After movement, if an agent lands on a
  non-walkable patch, it is snapped back to its previous position

### What we chose not to implement

- **ORCA for static obstacles**: Static obstacles are handled through the
  distance field (routing around them), the obstacle utility term (keep-clear
  margin), and the hard barrier snap-back.
- **Continuous-time formulation**: Discrete time steps at 0.25s per tick.
- **Alpha blending / distance-based authority**: Earlier iterations blended
  ORCA's influence by distance, but with a short time horizon (1.0s) ORCA only
  fires at close range where full authority is appropriate.
- **Head-on bias nudge**: Tested but removed; the right-leg projection resolves
  head-on encounters sufficiently.
- **Correction persistence**: Tested accumulating ORCA deflections across ticks
  and boosting momentum to preserve them, but this caused overreaction and
  double-counting. The current architecture lets each tick be independent.

### Key parameter values

| Parameter                   | Value  | Rationale                                            |
| --------------------------- | ------ | ---------------------------------------------------- |
| `timeHorizonWalking = 1.0s` |        | Short horizon — react to imminent collisions only    |
| `timeHorizonEngaged = 1.5s` |        | Slightly longer for shopping/waiting agents          |
| `maxNeighbors = 6`          |        | Computational bound on ORCA constraint count         |
| `neighborDist = 10m`        |        | Covers closure speed envelope                        |
| `radiusMultiplier = 0.7`    |        | agentRadius = personalSpace × 0.7                    |
| `engagedBlend = 0.3`        |        | ORCA compliance for engaged agents                   |
| `spatialHashCellSize = 15`  |        | Grid cell for neighbor queries (≥ neighborDist)      |

---

## 3. Speed-Density — Weidmann (1993)

**_Transporttechnik der Fussgänger_**
_ETH Zürich, IVT Report 90_

### What the paper proposes

Empirical fundamental diagram relating pedestrian speed to local density:

```
v(ρ) = v₀ × (1 − exp(−γ × (1/ρ − 1/ρ_max)))
```

where v₀ = free-flow speed, γ = shape parameter, ρ_max = jam density.

Weidmann's meta-analysis of ~25 studies (mostly European/North American) yields:

- **v₀ = 1.34 m/s** — free-flow walking speed (meta-analysis mean)
- **γ = 1.913 /m²** — shape ("gauge") constant
- **ρ_max = 5.4 ped/m²** — jam density (standstill)

Known as the "NKW" functional form (Newell–Kladek–Weidmann). Standard for
validation of pedestrian flow models, especially in German-speaking countries.

### Walking speed in context

Weidmann's 1.34 m/s is a global mean. Empirical studies show variation:

- **Nigeria**: ~1.19–1.25 m/s (Kano, city-wide study; Cameroon: 1.33 m/s)
- **Bangladesh**: 0.78–0.98 m/s (precinct to sidewalk; Khulna & Dhaka studies)
- **Hot climate effect**: 5–10% speed reduction in tropical conditions
- **Commercial areas**: Lower speeds than through-traffic corridors
- **Age/gender**: Young adults 1.4–1.5 m/s; older adults 1.0–1.2 m/s
- **Design standards**: US HCM uses 1.2 m/s as conservative design value

### What we implemented

- Speed factor function `weidmannSpeedFactor(density)` returning [0, 1]
- Applied per-tick to each agent's speed based on smoothed local density
- Density computed from a 5×5 patch neighborhood (~25m²) for smooth modulation
- Parameters: γ = 1.913, ρ_max = 5.4 ped/m²
- Default free-flow speed: **1.34 m/s** (Weidmann meta-analysis mean)
- Configurable range: 0.8–2.0 m/s (covers elderly to brisk walkers)

### Design choice: density at two scales

We use density at two different spatial scales for different purposes:

- **Route choice** (Antonini): directional lookahead density (15-patch ray scan)
  — needed to discriminate between adjacent patches for heading decisions
- **Speed modulation** (Weidmann): the MNL softmax-weighted areal density along
  the chosen path is used as the perceived density for the Weidmann speed
  function. One perception drives both heading and speed decisions.

---

## 4. Personal Space — Hall (1966)

**_The Hidden Dimension_**
_Doubleday & Company_

### What the paper proposes

Hall's proxemic zones define concentric distance thresholds around a person:

- **Intimate** (0–0.46m / 0–18″): Close contact, reserved for intimates
- **Personal close** (0.46–0.76m / 1.5–2.5′): Close friends
- **Personal far** (0.76–1.22m / 2.5–4′): Arm's-length interaction
- **Social close** (1.22–2.13m / 4–7′): Formal interaction
- **Social far** (2.13–3.66m / 7–12′): Across-room distance
- **Public** (>3.66m / >12′): Public speaking distance

### Cultural variation

Hall noted that interpersonal distances vary significantly by culture. Latin
American, Arab, and African cultures maintain closer conversational distances
than Northern European/North American norms. Southern European cultures (Italy,
Greece) are "high-contact" compared to Northern European (UK, France,
Netherlands). For a Freetown market, slightly reduced personal space is
culturally appropriate.

### How personal space maps to our model

The `personalSpace` parameter controls two things:

1. **ORCA collision radius**: `agentRadius = personalSpace × 0.7`. Two agents
   collide at `2 × 0.7 × personalSpace` centre-to-centre distance.
2. **Ease-of-movement zones**: Intimate (1×), Personal (1.35×), Social (4.1×).

| personalSpace    | ORCA radius | Hall zone placement               |
| ---------------- | ----------- | --------------------------------- |
| 0.45m (min)      | 0.315m      | Intimate boundary — crush density |
| 0.90m (default)  | 0.63m       | Mid personal-far zone — strangers |
| 1.22m            | 0.854m      | Personal → social boundary        |
| 1.50m (max)      | 1.05m       | Inside social zone — spacious     |

### What we implemented

- Default personal space = 0.90m (mid personal-far zone)
- Configurable via UI slider: 0.45–1.50m
- Three proxemic zone thresholds for ease-of-movement tracking:
  - Intimate: 1.0 × personalSpace (< 0.90m at default — within comfort minimum)
  - Personal: 1.35 × personalSpace (< 1.22m — personal → social boundary)
  - Social: 4.1 × personalSpace (< 3.69m — social → public boundary)
  - Public: ≥ 4.1 × personalSpace (≥ 3.69m — no crowding effect)
- Zone violations counted per-tick and displayed as doughnut chart in UI

---

## 5. Following — Position-Based Co-Directional Tracking

Not based on a single paper. Draws on concepts from:

- **Reynolds (1987)**: "Flocks, herds, and schools" — alignment and cohesion
  rules in boid models
- **Moussaïd et al. (2011)**: "How simple rules determine pedestrian behavior
  and crowd disasters" — empirical observation that pedestrians follow the
  person ahead, especially in crowded conditions
- **Antonini et al. (2006)**: Leader-follower interactions in constrained regime
  (our implementation differs from Antonini's utility-based approach)

### What we implemented

A post-MNL heading nudge that steers agents toward the **position** (not heading)
of the nearest co-directional agent ahead:

- **Forward cone**: ±60° half-angle, 8m radius
- **Co-directional filter**: Neighbor's velocity must align with agent's heading
  (dot product > 0.3, i.e., within ~73°)
- **Position-based steering**: Agent blends toward the leader's position rather
  than matching heading. This creates visible single-file chains — heading-based
  following was tested first but produced no visible effect because co-directional
  agents already share near-identical MNL headings on the same Dijkstra field.
- **Density-gated**: Following strength scales with the count of **oncoming**
  agents ahead (not all neighbors). No effect in open space; ramps linearly
  from 0 oncoming to `crowdingFull` (3) oncoming agents at full strength.
- **Pinch-point slowdown**: When oncoming agents are detected ahead, speed is
  reduced proportionally (up to 50% at full crowding), producing natural
  bottleneck queuing independent of whether a co-directional leader exists.

### Key parameter values

| Parameter               | Value | Rationale                                              |
| ----------------------- | ----- | ------------------------------------------------------ |
| `radius = 8m`           |       | Lookahead for leader detection                         |
| `coneHalfAngleDeg = 60` |       | ±60° forward cone (120° total)                         |
| `blendStrength = 0.75`  |       | Strong position-based steering at full crowding        |
| `crowdingOnset = 0`     |       | Following begins with first oncoming agent             |
| `crowdingFull = 3`      |       | Full strength at 3 oncoming agents                     |
| `pinchSlowdown = 0.5`   |       | Halve speed at full oncoming crowding                  |

---

## 6. Momentum Smoothing

Analogous to the relaxation time τ in the Social Force Model
(Helbing & Molnár, 1995). Agents blend toward their desired heading rather
than snapping instantly, producing smooth trajectories.

### What we implemented

- **Pre-ORCA temporal smoothing**: Each tick, heading is blended between the MNL
  output and the previous post-ORCA heading (`_mnlHeading`), weighted by the
  agent's momentum preference.
- **Per-agent variation**: Individual momentum scaled by behaviorDiversity.
- **Post-ORCA heading storage**: The heading after ORCA correction is stored as
  the momentum reference for the next tick. This means ORCA deflections persist
  through the momentum mechanism — the agent "remembers" its avoidance direction.

| Parameter           | Value | Rationale                                                        |
| ------------------- | ----- | ---------------------------------------------------------------- |
| `base = 0.6`        |       | Moderate smoothing — balances responsiveness and visual coherence |
| `cap = 0.8`         |       | Hard max prevents total heading lock                             |
| `spreadScale = 0.6` |       | Per-agent variation = diversity × this                           |

---

## 7. Engagement Model

Not based on a specific paper. Custom implementation for market context.

### What we implemented

- **Bernoulli engagement**: Per-minute probability of stopping at stalls (shopping)
  or furniture (resting), configurable via UI
- **Crowding discount**: Engagement probability → 0 when local density > threshold
  (2.0 ped/m²)
- **Amenity gradient**: Engaged agents seek toward stall/furniture potential peaks
- **Duration**: Random duration up to configurable max (3 minutes each)
- **Potential zones**: Graduated heading/speed weights at low/mid/high potential
- **Stuck timeout**: Safety valve — disengage if agent can't reach amenity
  within 30 seconds

### Possible future improvements

- **Huff gravity model**: Attraction proportional to stall size, inversely
  proportional to distance
- **Activity scheduling**: Pre-determined shopping lists rather than Bernoulli
- **Duration models**: Log-normal or gamma distributions rather than uniform

---

## 8. Distance Fields & Pathfinding

### What we implemented

- **Multi-source Dijkstra** on 8-connected grid for each destination node
- **Edge penalty**: Patches adjacent to obstacles get 1.08× traversal cost
  (decaying over 6 patches), gently favouring centre-of-corridor paths
- **Walkability mask**: Surface AND NOT stalls AND NOT furniture
- Stored as `Float32Array` per node, accessed at decision time as `patch[nodeId]`

### Alternative considered

- **A\*** search per agent: More memory-efficient for few agents, but our
  precomputed distance fields are O(1) lookup per agent per tick, which scales
  better for hundreds of agents

---

## 9. Barrier Enforcement

### What we implemented

Two-layer protection against agents entering non-walkable areas:

1. **Surface recovery** (pre-movement): If an agent is already on a non-walkable
   patch (`surfacePotential < 0`), heading is set 100% toward the nearest
   walkable surface gradient — a hard override, not a blend.
2. **Post-movement snap-back**: After `t.forward()`, if the agent's new patch
   has `surfacePotential < 0`, it is snapped back to its previous position.
   This guarantees agents cannot pass through stalls or walls regardless of
   what heading the pipeline produces.

---

## 10. Models Considered but Not Implemented

### Helbing & Molnár (1995) — Social Force Model

**"Social force model for pedestrian dynamics"**
_Physical Review E, 51(5), 4282_

Force-based attraction toward destination, repulsion from obstacles and other
pedestrians. The most widely cited pedestrian model, but:

- ORCA provides stronger collision-free guarantees
- Social force can produce oscillation artifacts at high density
- ORCA's velocity-space approach is more computationally stable

Our momentum smoothing (§6) is conceptually analogous to the SFM relaxation
time τ, but applied as heading blending rather than force integration.

### Seitz & Köster (2012) — Optimal Steps Model

Agents minimize continuous cost function: distance + deviation + obstacle.
More geometrically precise than grid-based scoring but requires per-step
continuous optimization. Not practical for our patch-based architecture.

### Burstedde et al. (2001) — Floor Field Cellular Automaton

Static field (distance to exits) + dynamic field (pheromone trails). Our distance
fields are the static component. The position-based following behavior (§5)
serves a similar role to the dynamic trail field, producing queuing and
channelling without explicit pheromone mechanics.

---

## 11. Architecture Summary

The model layers eight complementary systems per tick:

```
1. Route Choice (Antonini MNL)     → WHERE to go next (direction among 8 neighbors)
   ↓
2. Amenity Engagement (custom)     → WHETHER to stop at stalls/furniture
   ↓
3. Surface Recovery                → ENFORCE walkable area (hard override if off-surface)
   ↓
4. Following (position-based)      → QUEUE behind co-directional leaders (density-gated)
   ↓
5. Momentum Smoothing              → SMOOTH heading across ticks (temporal continuity)
   ↓
6. Speed (Weidmann + pinch)        → HOW FAST (density-dependent + oncoming slowdown)
   ↓
7. Collision Avoidance (ORCA)      → FINAL heading/speed (velocity-space LP, direct authority)
   ↓
8. Barrier Snap-Back               → GUARANTEE no wall/stall penetration (post-movement check)
```

Each layer operates on the output of the previous one, in sequence per tick.
ORCA runs last so collision avoidance is never overridden. The barrier snap-back
provides a hard physical guarantee independent of the heading pipeline.

---

## References

- Antonini, G., Bierlaire, M. & Weber, M. (2006). Discrete choice models of
  pedestrian walking behavior. _Transportation Research Part B_, 40(8), 667–687.
- Burstedde, C. et al. (2001). Simulation of pedestrian dynamics using a
  two-dimensional cellular automaton. _Physica A_, 295(3-4), 507–525.
- Hall, E.T. (1966). _The Hidden Dimension_. Doubleday.
- Helbing, D. & Molnár, P. (1995). Social force model for pedestrian dynamics.
  _Physical Review E_, 51(5), 4282.
- Moussaïd, M., Helbing, D. & Theraulaz, G. (2011). How simple rules determine
  pedestrian behavior and crowd disasters. _PNAS_, 108(17), 6884–6888.
- Reynolds, C.W. (1987). Flocks, herds, and schools: A distributed behavioral
  model. _ACM SIGGRAPH Computer Graphics_, 21(4), 25–34.
- Seitz, M.J. & Köster, G. (2012). Natural discretization of pedestrian movement
  in continuous space. _Physical Review E_, 86(4), 046108.
- van den Berg, J. et al. (2011). Reciprocal n-body collision avoidance.
  _Robotics Research_, 70, 3–19.
- Weidmann, U. (1993). _Transporttechnik der Fussgänger_. ETH Zürich, IVT
  Report 90.
