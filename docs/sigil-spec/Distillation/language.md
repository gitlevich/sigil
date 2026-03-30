---
status: wip
---
# Distillation

Distillation refines the precision and resolution of trajectories with a @DesignPartner until the projection is unambiguous where it must be.

The partner inhabits the entire tree — every trajectory at every level. It detects where trajectories are thin (low resolution: too few narration points to constrain the projection), discontinuous (a gap between levels where direction was lost), or contradictory (a lower level conflicts with the bearing established above it).

@SigilCoherence measures the quality of the trajectories in embedding space: whether the narration at each level clusters tightly around the direction established above, whether boundaries between sibling trajectories are clean, whether leaves have accumulated enough direction to project without ambiguity.
