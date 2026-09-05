# @regular-software/sync-protocol

Shared protocol types and helpers for regular software sync.

Snapshots return materialized rows. Incremental responses return ordered packets.
Each logical mutation has one version; multiple row packets from one mutation share that version.

This is a 0.x package; APIs may change between minor versions.
