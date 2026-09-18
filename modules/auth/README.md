# Auth module

The auth module declares Flower's identity and session integration boundary. In F3 it generates a typed capability descriptor and participates in dependency resolution, ownership, removal, and ejection.

It does not yet create database objects, configure Supabase Auth, or claim that authentication is enforced. Those runtime and security guarantees require the F4 migration and security engines.
