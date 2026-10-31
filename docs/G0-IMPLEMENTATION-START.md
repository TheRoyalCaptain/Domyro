# Domyro — G0 foundation-start authorization

**Date:** 2026-10-31  
**Approved by:** @TheRoyalCaptain (explicit response "Oké start maar" after the assistant asked for formal permission to begin programming).  
**Scope:** controlled **0.1 foundation source development** in the GitHub repository, adhering to product requirements D-01..D-52 and GOV-01 (branch protection voluntarily deferred).

The approval allows creating and editing source code, tests and development UI. It does **not** authorize running software on the owner's Ubuntu/HA servers, changing MQTT, Zigbee or Matter configuration, purchasing hardware, opening a WAN port, publishing packages or authorizing production release.

The first deliberately limited increment uses dependency-free Node.js HTTP with simple domain primitives. It is locally testable without introducing a database connection, and is **not** a finished TypeScript/Fastify/React/PostgreSQL implementation. Those remain the intended stack subject to verified versions, dependency-license review, security work and technical architecture sign-off. The temporary preview has no authentication, binds to loopback by default, cannot control devices and must not be deployed openly.

**Still-open engineering/release gates:** approved final architecture ADRs, dependency/license and vulnerability audit, supported Ubuntu LTS+ARM64 test matrix, secure secrets/auth, PostgreSQL lifecycle, validated real-hardware test setup and user authorization before real network actuation. These will be completed per stage, not inaccurately marked passed.

**G0 status:** explicitly approved to **begin M1 foundation code**. Production installation, real device actuation and release gates remain closed. Prior planning-only status is superseded only for this narrow foundation-start scope.
