"""
Hilfsskript: Zeigt alle angeschlossenen NFC-Reader mit ihren Namen.
Damit finden wir heraus, wie deine zwei Reader heißen,
um sie festen Räumen zuzuordnen.

Nutzung:
    py list_readers.py
"""

from smartcard.System import readers

def main():
    r = readers()
    if not r:
        print("✗ Keine Reader gefunden. USB-Verbindung prüfen.")
        return

    print(f"\n{len(r)} Reader gefunden:\n")
    print("─" * 60)
    for i, reader in enumerate(r):
        print(f"  Index {i}:  {reader}")
    print("─" * 60)
    print("\nNotiere dir, welcher Reader zu welchem Raum gehört.")
    print("Diese Namen tragen wir dann in die Konfiguration ein.\n")

    print("Tipp: Ziehe einen Reader ab, starte das Skript erneut,")
    print("      dann siehst du welcher Name verschwindet = welcher Reader es war.\n")

if __name__ == "__main__":
    main()
