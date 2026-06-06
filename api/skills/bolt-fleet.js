module.exports = {
  id: 'bolt-fleet',
  name: 'Bolt KSA Fleet Operations',
  keywords: [
    'bolt', 'fleet', 'bike', 'bikes', 'rider', 'riders', 'driver', 'drivers',
    'supply', 'utilization', 'dispatch', 'geofence', 'geofencing', 'activation',
    'deactivation', 'zone', 'zones', 'active bikes', 'idle', 'offline bike',
    'fleet health', 'fleet ops', 'fleet manager',
    'دراجة', 'دراجات', 'بولت', 'سائق', 'سائقين', 'كوريير', 'منطقة',
  ],
  context: `SKILL: Bolt KSA Fleet Operations
Muhammad manages ~102 bikes on the Bolt delivery network in Riyadh (KSA).

KEY METRICS:
- Fleet utilization rate = active orders / available bikes per hour (healthy: >65%)
- Active ratio = bikes online and accepting / total fleet (target: >80% peak hours)
- Idle time per bike = time online but not on order (flag if >40% of shift)
- Zone coverage = bikes distributed across demand zones (flag gaps vs. demand heatmap)

SUPPLY LEVERS:
- Activation push: direct outreach to dormant bikes (offline >48h) via phone or in-app push
- Zone rebalancing: move idle supply from low-demand zones to high-demand ones
- Incentive triggers: bonus per X orders in high-demand zones/hours to attract supply
- Deactivation: suspend bikes with low acceptance rate or repeated violations

COMMON ISSUES & RESPONSES:
- Bike offline mid-shift → check battery, phone data, or app crash; escalate if >3 bikes
- Supply shortage at peak (lunch 12–2pm, dinner 6–9pm) → activate reserve/on-call riders
- Zone imbalance → redistribute existing supply, don't add headcount unnecessarily
- Low acceptance rate cluster → investigate: wrong zone assignment, fatigue, or weak incentive

BOLT-SPECIFIC CONTEXT:
- Fleet configuration managed via Bolt Fleet Manager portal
- Order assignment is algorithmic; Muhammad influences supply quantity/location, not dispatch logic
- Riyadh SLA targets: specific uptime and EDT commitments per city contract
- Weekly performance reports from Bolt: review utilization, completion rate, cancellation rate`,
};
