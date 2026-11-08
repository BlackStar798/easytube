#!/usr/bin/env python3
"""
Prépare le .zip à envoyer : installateur + README.txt (français + anglais, avec le journal
des changements). À lancer après la compilation de l'installateur :

    python3 release/make_release.py                              # Windows : EasyTube-Setup-<v>.zip
    python3 release/make_release.py --mac --min-macos 12.0       # macOS   : EasyTube-<v>-mac-arm64.zip
                                                                 #   (le .dmg doit être dans dist/ ; --arch x64 pour Intel)

Pour chaque nouvelle version : ajouter UNE entrée en tête de release/changelog.json
(« fr » et « en »). Le script refuse de continuer s'il manque.
"""
import hashlib, json, os, shutil, subprocess, sys, tempfile, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
REF = os.environ.get('EASYTUBE_REF', '')  # optional: folder where a SHA256-<version>.txt copy is kept

MAC = '--mac' in sys.argv
def arg_of(name, default=''):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv and sys.argv.index(name) + 1 < len(sys.argv) else default
MAC_ARCH = arg_of('--arch', 'arm64')
MIN_MACOS = arg_of('--min-macos', '')
if MAC and MAC_ARCH not in ('arm64', 'x64'):
    sys.exit('ERREUR : --arch doit être arm64 ou x64.')
if MAC and not MIN_MACOS:
    sys.exit('ERREUR : indique la version minimale de macOS avec --min-macos (lue dans Info.plist : LSMinimumSystemVersion).')

version = json.load(open(os.path.join(ROOT, 'package.json'), encoding='utf8'))['version']
log = json.load(open(os.path.join(ROOT, 'release', 'changelog.json'), encoding='utf8'))
if log[0]['version'] != version:
    sys.exit(f"ERREUR : package.json = {version}, mais la 1re entrée du journal est {log[0]['version']}. Ajoute l'entrée {version} dans release/changelog.json.")
if not MAC:
    nsi = open(os.path.join(ROOT, 'installer.nsi'), encoding='utf8').read()
    if f'!define APPVERSION "{version}"' not in nsi:
        sys.exit(f"ERREUR : installer.nsi n'est pas en version {version}.")

exe_name = f'EasyTube-{version}-mac-{MAC_ARCH}.dmg' if MAC else f'EasyTube-Setup-{version}.exe'
exe = os.path.join(DIST, exe_name)
if not os.path.exists(exe):
    sys.exit(f"ERREUR : {exe} introuvable (compile l'installateur d'abord).")
sha = hashlib.sha256(open(exe, 'rb').read()).hexdigest()


def changelog(lang):
    out = []
    for e in log:
        title = e.get(f'title_{lang}')
        head = f"{e['version']}" + (f' - {title}' if title else '') + (' (this version / cette version)' if False else '')
        out.append(head)
        out.append('-' * len(head))
        out += [f'  * {line}' for line in e[lang]]
        out.append('')
    return out

FR = f"""
INSTALLATION
------------
1. Décompresse ce .zip, puis double-clique sur {exe_name}
2. L'installateur t'explique ce qu'est EasyTube, puis te laisse choisir le dossier d'installation.
   Mise à jour : installe simplement par-dessus l'ancienne version (même dossier). Elle est remplacée
   sur place et tes réglages, ton historique et ta copie de yt-dlp sont conservés.
3. Lance EasyTube depuis le Bureau ou le menu Démarrer.
   Le programme démarre en anglais : le sélecteur EN | FR en haut à droite passe en français.
   Désinstallation (Paramètres Windows > Applications > EasyTube) : l'installateur demande si tu veux
   garder tes réglages et ton historique.

SI L'ANTIVIRUS (KASPERSKY) BLOQUE QUELQUE CHOSE
-----------------------------------------------
L'installateur n'est pas signé numériquement : les antivirus s'en méfient parfois (faux positif).
 - Kaspersky > Plus d'outils > Quarantaine > Restaurer, en ajoutant le fichier aux exclusions ;
 - vérifier le fichier sur https://www.virustotal.com avec l'empreinte SHA-256 :
   {sha}
 - signaler un faux positif : https://opentip.kaspersky.com
 - SmartScreen : Informations complémentaires > Exécuter quand même.

LICENCES
--------
EasyTube est un logiciel libre (licence MIT). Il inclut yt-dlp, FFmpeg, Electron et la police
Bricolage Grotesque, qui gardent chacun leur propre licence. Les textes complets sont dans le
dossier « licenses », installé avec le programme (Réglages > À propos > Ouvrir le dossier des licences).

JOURNAL DES CHANGEMENTS (du plus récent au plus ancien)
-------------------------------------------------------
""".strip('\n').split('\n') + [''] + changelog('fr')

EN = f"""
INSTALL
-------
1. Unzip this file, then double-click {exe_name}
2. The installer explains what EasyTube is, then lets you choose the install folder.
   Updating: just install over the previous version (same folder). It is replaced in place and your
   settings, history and yt-dlp copy are kept.
3. Start EasyTube from the Desktop or the Start menu.
   The app starts in English: the EN | FR switch at the top right changes to French.
   Uninstalling (Windows Settings > Apps > EasyTube): the uninstaller asks whether to keep your
   settings and history.

IF YOUR ANTIVIRUS (KASPERSKY) BLOCKS SOMETHING
----------------------------------------------
The installer is not digitally signed, so antivirus software is sometimes wary of it (false positive).
 - Kaspersky > More Tools > Quarantine > Restore, and add the file to the exclusions;
 - check the file on https://www.virustotal.com using its SHA-256 fingerprint:
   {sha}
 - report a false positive: https://opentip.kaspersky.com
 - SmartScreen: More info > Run anyway.

LICENSES
--------
EasyTube is free software (MIT License). It includes yt-dlp, FFmpeg, Electron and the Bricolage
Grotesque font, each under its own license. The full texts are in the "licenses" folder installed
with the program (Settings > About > Open the licenses folder).

CHANGELOG (newest first)
------------------------
""".strip('\n').split('\n') + [''] + changelog('en')

FR_MAC = f"""
INSTALLATION
------------
1. Décompresse ce .zip, puis double-clique sur {exe_name}
2. Glisse EasyTube sur le dossier Applications dans la fenêtre qui s'ouvre.
3. Premier lancement : l'app n'est pas notarisée par Apple (cela demande un compte développeur payant),
   donc macOS refuse de l'ouvrir la première fois (« Apple n'a pas pu vérifier… »). À faire UNE seule fois :
   ouvre Réglages Système > Confidentialité et sécurité, descends jusqu'au message qui parle d'EasyTube,
   clique sur « Ouvrir quand même », puis confirme.
   (Variante Terminal : xattr -dr com.apple.quarantine /Applications/EasyTube.app)
4. Le programme démarre en anglais : le sélecteur EN | FR en haut à droite passe en français.
   Mise à jour : glisse la nouvelle version dans Applications (elle remplace l'ancienne) ; tes réglages,
   ton historique et ta copie de yt-dlp sont conservés (dossier ~/Library/Application Support/EasyTube).
   Désinstallation : glisse EasyTube à la corbeille ; pour effacer aussi tes réglages, supprime ce dossier.

CONFIGURATION REQUISE
---------------------
Mac Apple Silicon ({'M1 ou plus récent' if MAC_ARCH == 'arm64' else 'Intel'}), macOS {MIN_MACOS} ou plus récent.

VÉRIFIER LE FICHIER
-------------------
Empreinte SHA-256 de {exe_name} (Terminal : shasum -a 256 <fichier>) :
   {sha}
Tu peux aussi faire analyser le fichier sur https://www.virustotal.com

LICENCES
--------
EasyTube est un logiciel libre (licence MIT). Il inclut yt-dlp, FFmpeg, Electron et la police
Bricolage Grotesque, qui gardent chacun leur propre licence. Les textes complets sont dans le
dossier « licenses » de l'application (clic droit sur EasyTube > Afficher le contenu du paquet >
Contents > Resources), ou dans Réglages > À propos > Ouvrir le dossier des licences.

JOURNAL DES CHANGEMENTS (du plus récent au plus ancien)
-------------------------------------------------------
""".strip('\n').split('\n') + [''] + changelog('fr')

EN_MAC = f"""
INSTALL
-------
1. Unzip this file, then double-click {exe_name}
2. In the window that opens, drag EasyTube onto the Applications folder.
3. First launch: the app is not notarized by Apple (that needs a paid developer account), so macOS refuses
   to open it the first time ("Apple could not verify..."). Do this ONCE:
   open System Settings > Privacy & Security, scroll down to the message about EasyTube,
   click "Open Anyway", then confirm.
   (Terminal alternative: xattr -dr com.apple.quarantine /Applications/EasyTube.app)
4. The app starts in English: the EN | FR switch at the top right changes to French.
   Updating: drag the new version into Applications (it replaces the old one); your settings, history
   and yt-dlp copy are kept (folder ~/Library/Application Support/EasyTube).
   Uninstalling: drag EasyTube to the Trash; to also erase your settings, delete that folder.

REQUIREMENTS
------------
Apple Silicon Mac ({'M1 or newer' if MAC_ARCH == 'arm64' else 'Intel'}), macOS {MIN_MACOS} or newer.

CHECK THE FILE
--------------
SHA-256 fingerprint of {exe_name} (Terminal: shasum -a 256 <file>):
   {sha}
You can also have the file scanned on https://www.virustotal.com

LICENSES
--------
EasyTube is free software (MIT License). It includes yt-dlp, FFmpeg, Electron and the Bricolage
Grotesque font, each under its own license. The full texts are in the app's "licenses" folder
(right-click EasyTube > Show Package Contents > Contents > Resources), or in
Settings > About > Open the licenses folder.

CHANGELOG (newest first)
------------------------
""".strip('\n').split('\n') + [''] + changelog('en')
if MAC_ARCH == 'x64':
    FR_MAC = [l.replace('Mac Apple Silicon (Intel)', 'Mac Intel') for l in FR_MAC]
    EN_MAC = [l.replace('Apple Silicon Mac (Intel)', 'Intel Mac') for l in EN_MAC]

bar = '=' * 62
if MAC:
    FR, EN = FR_MAC, EN_MAC
lines = [f'EASYTUBE {version}', bar,
         'Free, open-source video downloader for macOS, built on yt-dlp.' if MAC else 'Free, open-source video downloader for Windows, built on yt-dlp.',
         "Interface gratuite et open source pour télécharger des vidéos, basée sur yt-dlp.",
         '', bar, '  FRANÇAIS', bar] + FR + [bar, '  ENGLISH', bar] + EN
text = '\r\n'.join(lines).rstrip() + '\r\n'

readme = os.path.join(DIST, 'README-mac.txt' if MAC else 'README.txt')
open(readme, 'w', encoding='utf-8-sig', newline='').write(text)
old = os.path.join(DIST, 'LISEZMOI.txt')
if os.path.exists(old):
    os.remove(old)

zip_path = os.path.join(DIST, f'EasyTube-{version}-mac-{MAC_ARCH}.zip' if MAC else f'EasyTube-Setup-{version}.zip')
if os.path.exists(zip_path):
    os.remove(zip_path)
if MAC and sys.platform == 'darwin' and shutil.which('ditto'):
    # On a Mac the zip is made with `ditto`, like Finder's "Compress": it keeps the custom icon of the .dmg file
    # (stored in extended attributes, saved in the zip as __MACOSX/._<file>) so it shows up after unzipping.
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['ditto', exe, os.path.join(tmp, exe_name)], check=True)  # ditto copies the extended attributes (icon); shutil does not
        shutil.copyfile(readme, os.path.join(tmp, 'README.txt'))
        subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', tmp, zip_path], check=True)
else:
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_STORED) as zf:
        zf.write(exe, exe_name)
        zf.write(readme, 'README.txt')
    if MAC:
        print("NOTE : zip fait hors macOS : le .dmg y perd son icône personnalisée (cosmétique). Sur un Mac, le script utilise `ditto` et la garde.")
if REF:
    os.makedirs(REF, exist_ok=True)
    open(os.path.join(REF, f'SHA256-{version}.txt'), 'w').write(f'{sha}  {exe_name}\n')
print(f'{os.path.basename(zip_path)} : {os.path.getsize(zip_path) // 1048576} Mo')
print(f'SHA-256 {exe_name}: {sha}')
