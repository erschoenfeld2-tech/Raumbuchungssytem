"""
Testskript: Liest die UID einer NFC-Karte mit dem ACR122U (oder kompatiblen) Reader.

Voraussetzung:
    pip install pyscard

Nutzung:
    1. Reader per USB anschliessen (Windows erkennt ihn automatisch als Smartcardleser)
    2. Skript starten
    3. Karte an den Reader halten
    4. Die UID wird ausgegeben
"""

from smartcard.System import readers
from smartcard.util import toHexString
from smartcard.Exceptions import NoCardException, CardConnectionException
import time


def get_reader():
    """Sucht nach verfuegbaren Smartcard-Readern und gibt den ersten zurueck."""
    r = readers()
    if not r:
        raise RuntimeError(
            "Kein Reader gefunden. Pruefe, ob der NFC-Reader per USB "
            "angeschlossen ist und im Geraete-Manager als Smartcardleser erscheint."
        )
    print(f"Gefundene Reader: {[str(x) for x in r]}")
    return r[0]


def read_uid(connection):
    """Sendet das Standard-APDU-Kommando zum Auslesen der Karten-UID."""
    # Standard PC/SC Befehl: Get Data (UID) - funktioniert bei den meisten
    # ISO14443 Type A Karten (MIFARE etc.)
    GET_UID = [0xFF, 0xCA, 0x00, 0x00, 0x00]
    response, sw1, sw2 = connection.transmit(GET_UID)

    if sw1 == 0x90 and sw2 == 0x00:
        uid = toHexString(response).replace(" ", "")
        return uid
    else:
        raise CardConnectionException(
            f"Unerwartete Antwort: SW1={sw1:02X} SW2={sw2:02X}"
        )


def main():
    reader = get_reader()
    print("Bereit. Halte eine Karte an den Reader (Strg+C zum Beenden)...")
    print("-" * 50)

    last_uid = None

    while True:
        try:
            connection = reader.createConnection()
            connection.connect()
            uid = read_uid(connection)

            if uid != last_uid:
                print(f"Karte erkannt! UID: {uid}")
                last_uid = uid

        except NoCardException:
            if last_uid is not None:
                print("Karte entfernt.")
                last_uid = None

        except CardConnectionException as e:
            print(f"Fehler beim Lesen: {e}")

        time.sleep(0.5)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nBeendet.")
    except RuntimeError as e:
        print(f"Fehler: {e}")
