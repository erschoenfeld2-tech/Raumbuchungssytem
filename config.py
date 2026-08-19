"""
Raumbuchungssystem – Konfiguration
====================================
Zentrale Einstellungen für das gesamte System.
Nur diese Datei muss angepasst werden wenn sich z.B. der SMTP-Server ändert.

WICHTIG: Diese Datei nicht in ein öffentliches Repository hochladen
         da sie Zugangsdaten enthält!
"""

# ── E-Mail / SMTP ──────────────────────────────────────────
# Für echten Betrieb: Zugangsdaten eures Firmen-SMTP-Servers eintragen
# Für Tests: Mailtrap.io nutzen (kostenlos, E-Mails werden abgefangen)

SMTP_SERVER   = "smtp.mailtrap.io"   # z.B. "smtp.office365.com" für Outlook
SMTP_PORT     = 587                  # 587 für TLS, 465 für SSL
SMTP_USER     = "dein_mailtrap_user" # SMTP Benutzername
SMTP_PASSWORD = "dein_mailtrap_pass" # SMTP Passwort
EMAIL_ABSENDER = "raumbuchung@firma.de"
EMAIL_ABSENDER_NAME = "Raumbuchungssystem"

# E-Mail-Versand aktivieren/deaktivieren (False = nur Konsolen-Ausgabe)
EMAIL_AKTIV = False  # auf True setzen sobald SMTP konfiguriert ist

# ── System ─────────────────────────────────────────────────
SYSTEM_NAME = "Raumbuchungssystem"
WEB_URL     = "http://localhost:8000"  # URL des Web-Interfaces im Netzwerk

# ── Buchungsregeln ─────────────────────────────────────────
NO_SHOW_MINUTEN       = 15   # Nach X Minuten ohne Check-in → No-Show
ERINNERUNG_MINUTEN    = 30   # X Minuten vor Buchungsbeginn → Erinnerung
CHECKIN_PUFFER_MINUTEN = 10  # X Minuten vor Start darf eingecheckt werden
