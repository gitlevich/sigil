During sleep, I #decay the weight of old facts. Facts older than 24 hours have their weight multiplied by a decay factor (default 0.8) on each sleep cycle.

Weight starts at 1.0 when a fact is created. After one sleep cycle past the recency window, it drops to 0.8. After two, 0.64. After five, 0.33. Weight is a proxy for relevance: facts that haven't been reinforced by recurrence fade naturally.

Decay does not delete. It reduces salience. A decayed fact still exists and can still be found by #recall if the query is close enough. But when #prune runs, facts below the noise floor are removed.