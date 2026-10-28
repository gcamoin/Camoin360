"""Shared application module policy. No administrator identities or credentials."""

MODULES = {"main": "Sophie Maintenance", "prospecting": "Prospecting", "consulting": "Consulting",
           "management": "Management", "admin": "Admin"}


def normalize_modules(modules):
    return [module for module in MODULES if module in set(modules or [])]
