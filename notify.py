"""
Raumbuchungssystem – E-Mail-Benachrichtigungen
===============================================
Verschickt automatisch E-Mails bei:
  - Buchungsbestätigung
  - Buchungserinnerung (30 Min vorher)
  - Check-in-Bestätigung
  - Stornierungsbestätigung
  - No-Show-Benachrichtigung

Dieses Modul wird von anderen Dateien importiert und aufgerufen:
  - api.py     → bei Buchung / Stornierung
  - checkin.py → bei erfolgreichem Check-in
  - noshow.py  → bei No-Show

Voraussetzung:
  - config.py liegt im selben Ordner
  - Für echten Versand: SMTP-Zugangsdaten in config.py eintragen
  - Für Tests: EMAIL_AKTIV = False in config.py lässt nur Konsolen-Ausgabe

Nutzung (aus anderen Dateien):
  from notify import sende_buchungsbestaetigung, sende_checkin_bestaetigung
"""

import smtplib
import threading
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime

import config


# ── Farben für Konsolenausgabe ─────────────────────────────
CYAN  = '\033[96m'
GREEN = '\033[92m'
AMBER = '\033[93m'
RED   = '\033[91m'
RESET = '\033[0m'


# ── Kernfunktion: E-Mail verschicken ──────────────────────

def _sende_email(empfaenger: str, betreff: str, text: str, html: str = None):
    """
    Interne Funktion: verschickt eine E-Mail.
    Wird immer in einem eigenen Thread aufgerufen damit das Hauptprogramm
    nicht wartet bis die E-Mail verschickt ist.
    """
    if not config.EMAIL_AKTIV:
        # Testmodus: nur Ausgabe in der Konsole
        print(f"\n{CYAN}📧 [E-Mail-Vorschau – Versand deaktiviert]{RESET}")
        print(f"   An:      {empfaenger}")
        print(f"   Betreff: {betreff}")
        print(f"   {AMBER}→ EMAIL_AKTIV = False in config.py (Testmodus){RESET}\n")
        return

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = betreff
        msg["From"]    = f"{config.EMAIL_ABSENDER_NAME} <{config.EMAIL_ABSENDER}>"
        msg["To"]      = empfaenger

        # Reiner Text (Fallback)
        msg.attach(MIMEText(text, "plain", "utf-8"))

        # HTML-Version falls vorhanden
        if html:
            msg.attach(MIMEText(html, "html", "utf-8"))

        with smtplib.SMTP(config.SMTP_SERVER, config.SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(config.SMTP_USER, config.SMTP_PASSWORD)
            server.send_message(msg)

        print(f"{GREEN}  ✓ E-Mail verschickt an {empfaenger}{RESET}")

    except smtplib.SMTPAuthenticationError:
        print(f"{RED}  ✗ E-Mail-Fehler: Falsche SMTP-Zugangsdaten in config.py{RESET}")
    except smtplib.SMTPConnectError:
        print(f"{RED}  ✗ E-Mail-Fehler: Keine Verbindung zu {config.SMTP_SERVER}{RESET}")
    except Exception as e:
        print(f"{RED}  ✗ E-Mail-Fehler: {e}{RESET}")


def sende_async(empfaenger: str, betreff: str, text: str, html: str = None):
    """Verschickt E-Mail asynchron – blockiert das Hauptprogramm nicht."""
    thread = threading.Thread(
        target=_sende_email,
        args=(empfaenger, betreff, text, html),
        daemon=True
    )
    thread.start()


# ── HTML-Template ──────────────────────────────────────────

def _html_template(titel: str, inhalt_zeilen: list, farbe: str = "#4F6EF7") -> str:
    """Erstellt ein einfaches HTML-E-Mail-Template."""
    zeilen_html = "".join(
        f"<p style='margin:6px 0;font-size:15px;color:#374151;'>{z}</p>"
        for z in inhalt_zeilen
    )
    return f"""
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;
                background:#f8f9ff;border-radius:12px;overflow:hidden;">
      <div style="background:{farbe};padding:24px 28px;">
        <h2 style="color:#fff;margin:0;font-size:20px;">🏢 {config.SYSTEM_NAME}</h2>
        <p  style="color:rgba(255,255,255,.8);margin:4px 0 0;font-size:14px;">{titel}</p>
      </div>
      <div style="padding:24px 28px;background:#fff;">
        {zeilen_html}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
        <p style="font-size:12px;color:#9ca3af;">
          Online buchen: <a href="{config.WEB_URL}" style="color:{farbe};">{config.WEB_URL}</a>
        </p>
      </div>
    </div>
    """


# ── Öffentliche Funktionen ─────────────────────────────────

def sende_buchungsbestaetigung(
    empfaenger: str,
    nutzer_name: str,
    raum_name: str,
    start_time: str,
    end_time: str,
    booking_id: int
):
    """
    Schickt eine Buchungsbestätigung.
    Aufruf aus api.py nach erfolgreicher Buchung.
    """
    # Datum und Uhrzeit lesbar formatieren
    start = datetime.strptime(start_time, "%Y-%m-%d %H:%M")
    end   = datetime.strptime(end_time,   "%Y-%m-%d %H:%M")
    datum = start.strftime("%A, %d. %B %Y")
    von   = start.strftime("%H:%M")
    bis   = end.strftime("%H:%M")

    betreff = f"✅ Buchungsbestätigung – {raum_name} am {start.strftime('%d.%m.')}"
    text = (
        f"Hallo {nutzer_name},\n\n"
        f"deine Buchung wurde erfolgreich erstellt.\n\n"
        f"Raum:    {raum_name}\n"
        f"Datum:   {datum}\n"
        f"Zeit:    {von} – {bis} Uhr\n"
        f"Buchung: #{booking_id}\n\n"
        f"Vergiss nicht, dich beim Betreten mit deiner NFC-Karte einzuchecken.\n\n"
        f"Viele Grüße\n{config.SYSTEM_NAME}"
    )
    html = _html_template(
        titel="Buchungsbestätigung",
        farbe="#4F6EF7",
        inhalt_zeilen=[
            f"Hallo <strong>{nutzer_name}</strong>,",
            "deine Buchung wurde erfolgreich erstellt:",
            f"<br><strong>📍 Raum:</strong> {raum_name}",
            f"<strong>📅 Datum:</strong> {datum}",
            f"<strong>⏰ Zeit:</strong> {von} – {bis} Uhr",
            f"<strong>🔖 Buchungs-ID:</strong> #{booking_id}",
            "<br>Vergiss nicht, dich beim Betreten mit deiner <strong>NFC-Karte einzuchecken</strong>.",
        ]
    )
    sende_async(empfaenger, betreff, text, html)


def sende_erinnerung(
    empfaenger: str,
    nutzer_name: str,
    raum_name: str,
    start_time: str,
    end_time: str
):
    """
    Schickt eine Erinnerung X Minuten vor Buchungsbeginn.
    Aufruf aus noshow.py im Erinnerungs-Check.
    """
    start = datetime.strptime(start_time, "%Y-%m-%d %H:%M")
    end   = datetime.strptime(end_time,   "%Y-%m-%d %H:%M")
    von   = start.strftime("%H:%M")
    bis   = end.strftime("%H:%M")

    betreff = f"⏰ Erinnerung – {raum_name} beginnt um {von} Uhr"
    text = (
        f"Hallo {nutzer_name},\n\n"
        f"deine Buchung beginnt in {config.ERINNERUNG_MINUTEN} Minuten.\n\n"
        f"Raum:  {raum_name}\n"
        f"Zeit:  {von} – {bis} Uhr\n\n"
        f"Bitte vergiss nicht, dich mit deiner NFC-Karte einzuchecken.\n\n"
        f"Viele Grüße\n{config.SYSTEM_NAME}"
    )
    html = _html_template(
        titel=f"Erinnerung – in {config.ERINNERUNG_MINUTEN} Minuten",
        farbe="#D97706",
        inhalt_zeilen=[
            f"Hallo <strong>{nutzer_name}</strong>,",
            f"deine Buchung beginnt in <strong>{config.ERINNERUNG_MINUTEN} Minuten</strong>:",
            f"<br><strong>📍 Raum:</strong> {raum_name}",
            f"<strong>⏰ Zeit:</strong> {von} – {bis} Uhr",
            "<br>Bitte vergiss nicht, dich mit deiner <strong>NFC-Karte einzuchecken</strong>.",
        ]
    )
    sende_async(empfaenger, betreff, text, html)


def sende_checkin_bestaetigung(
    empfaenger: str,
    nutzer_name: str,
    raum_name: str,
    start_time: str,
    end_time: str
):
    """
    Schickt eine Check-in-Bestätigung.
    Aufruf aus checkin.py nach erfolgreichem Check-in.
    """
    start    = datetime.strptime(start_time, "%Y-%m-%d %H:%M:%S")
    end      = datetime.strptime(end_time,   "%Y-%m-%d %H:%M:%S")
    von      = start.strftime("%H:%M")
    bis      = end.strftime("%H:%M")
    jetzt    = datetime.now().strftime("%H:%M")

    betreff = f"🟢 Check-in bestätigt – {raum_name}"
    text = (
        f"Hallo {nutzer_name},\n\n"
        f"dein Check-in wurde um {jetzt} Uhr erfolgreich registriert.\n\n"
        f"Raum:  {raum_name}\n"
        f"Zeit:  {von} – {bis} Uhr\n\n"
        f"Viele Grüße\n{config.SYSTEM_NAME}"
    )
    html = _html_template(
        titel="Check-in bestätigt",
        farbe="#16A34A",
        inhalt_zeilen=[
            f"Hallo <strong>{nutzer_name}</strong>,",
            f"dein Check-in wurde um <strong>{jetzt} Uhr</strong> erfolgreich registriert.",
            f"<br><strong>📍 Raum:</strong> {raum_name}",
            f"<strong>⏰ Zeit:</strong> {von} – {bis} Uhr",
            "<br>Viel Erfolg bei deiner Arbeit! 💪",
        ]
    )
    sende_async(empfaenger, betreff, text, html)


def sende_stornierung(
    empfaenger: str,
    nutzer_name: str,
    raum_name: str,
    start_time: str,
    end_time: str
):
    """
    Schickt eine Stornierungsbestätigung.
    Aufruf aus api.py nach Stornierung.
    """
    start = datetime.strptime(start_time, "%Y-%m-%d %H:%M:%S")
    end   = datetime.strptime(end_time,   "%Y-%m-%d %H:%M:%S")
    datum = start.strftime("%d.%m.%Y")
    von   = start.strftime("%H:%M")
    bis   = end.strftime("%H:%M")

    betreff = f"❌ Buchung storniert – {raum_name} am {datum}"
    text = (
        f"Hallo {nutzer_name},\n\n"
        f"deine Buchung wurde storniert.\n\n"
        f"Raum:  {raum_name}\n"
        f"Datum: {datum}\n"
        f"Zeit:  {von} – {bis} Uhr\n\n"
        f"Du kannst jederzeit eine neue Buchung vornehmen unter:\n{config.WEB_URL}\n\n"
        f"Viele Grüße\n{config.SYSTEM_NAME}"
    )
    html = _html_template(
        titel="Buchung storniert",
        farbe="#DC2626",
        inhalt_zeilen=[
            f"Hallo <strong>{nutzer_name}</strong>,",
            "deine Buchung wurde storniert:",
            f"<br><strong>📍 Raum:</strong> {raum_name}",
            f"<strong>📅 Datum:</strong> {datum}",
            f"<strong>⏰ Zeit:</strong> {von} – {bis} Uhr",
            f"<br>Du kannst jederzeit eine neue Buchung vornehmen.",
        ]
    )
    sende_async(empfaenger, betreff, text, html)


def sende_no_show(
    empfaenger: str,
    nutzer_name: str,
    raum_name: str,
    start_time: str
):
    """
    Schickt eine No-Show-Benachrichtigung.
    Aufruf aus noshow.py wenn kein Check-in erfolgte.
    """
    start = datetime.strptime(start_time, "%Y-%m-%d %H:%M:%S")
    datum = start.strftime("%d.%m.%Y")
    von   = start.strftime("%H:%M")

    betreff = f"⚠️ Buchung verfallen – {raum_name} um {von} Uhr"
    text = (
        f"Hallo {nutzer_name},\n\n"
        f"deine Buchung für {raum_name} am {datum} um {von} Uhr wurde als "
        f"'nicht erschienen' markiert, da kein Check-in erfolgte.\n\n"
        f"Der Raum wurde automatisch freigegeben.\n\n"
        f"Neue Buchung: {config.WEB_URL}\n\n"
        f"Viele Grüße\n{config.SYSTEM_NAME}"
    )
    html = _html_template(
        titel="Buchung verfallen – kein Check-in",
        farbe="#D97706",
        inhalt_zeilen=[
            f"Hallo <strong>{nutzer_name}</strong>,",
            f"deine Buchung für <strong>{raum_name}</strong> am {datum} um {von} Uhr "
            f"wurde als <strong>nicht erschienen</strong> markiert.",
            "<br>Du hast dich nicht mit deiner NFC-Karte eingecheckt.",
            "Der Raum wurde automatisch freigegeben.",
            "<br>Du kannst jederzeit eine neue Buchung vornehmen.",
        ]
    )
    sende_async(empfaenger, betreff, text, html)


# ── Testfunktion ───────────────────────────────────────────

def test_alle_emails():
    """
    Sendet alle E-Mail-Typen an eine Testadresse.
    Nutzung: py notify.py
    """
    test_email = input("  Testadresse eingeben: ").strip()
    if not test_email:
        print("  Keine Adresse eingegeben.")
        return

    print("\n  Sende alle E-Mail-Typen...")
    jetzt = datetime.now().strftime("%Y-%m-%d %H:%M")
    ende  = datetime.now().strftime("%Y-%m-%d") + " 11:00"

    sende_buchungsbestaetigung(test_email, "Max Mustermann",
        "Besprechungsraum A", jetzt, ende, booking_id=42)

    sende_erinnerung(test_email, "Max Mustermann",
        "Besprechungsraum A", jetzt, ende)

    sende_checkin_bestaetigung(test_email, "Max Mustermann",
        "Besprechungsraum A",
        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        datetime.now().strftime("%Y-%m-%d") + " 11:00:00")

    sende_stornierung(test_email, "Max Mustermann",
        "Besprechungsraum A",
        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        datetime.now().strftime("%Y-%m-%d") + " 11:00:00")

    sende_no_show(test_email, "Max Mustermann",
        "Besprechungsraum A",
        datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    print("\n  Fertig! Prüfe dein Postfach (oder die Konsolen-Vorschau oben).")


if __name__ == "__main__":
    print("=== E-Mail Testmodus ===\n")
    print(f"  EMAIL_AKTIV: {config.EMAIL_AKTIV}")
    print(f"  SMTP-Server: {config.SMTP_SERVER}:{config.SMTP_PORT}\n")
    test_alle_emails()
