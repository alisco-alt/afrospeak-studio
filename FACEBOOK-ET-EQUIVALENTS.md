# Facebook : toutes les voies testées, et ce qui le remplace

Document de référence, écrit après avoir épuisé les pistes techniques.
Question de l'utilisateur : *« Facebook est très important pour avoir des
images et vidéos d'actualité, car là-bas les gens publient énormément.
Y a-t-il une autre solution ? »*

La réponse honnête : **non pour Facebook lui-même**, mais le besoin réel
est couvert autrement — et mieux.

---

## 1. Les six voies testées (21/08/2026)

| voie | résultat | détail |
|---|---|---|
| `gallery-dl` recherche | ❌ | `Unsupported URL` — aucun extracteur de recherche |
| `gallery-dl` page publique | ❌ | `AuthRequired`, avec **et sans** cookies |
| `mbasic.facebook.com` | ❌ | HTTP 302 → redirection vers connexion |
| `r.jina.ai` sur une page | ❌ | HTTP 200 mais contenu = « Log into Facebook » |
| API Graph officielle | ❌ | `(#200) Provide valid app ID` |
| CDN `fbcdn.net` en direct | ❌ | HTTP 403 |

Aucune n'aboutit. Ce n'est pas un défaut de configuration.

---

## 2. Pourquoi les cookies ne suffisent pas

L'utilisateur était **connecté à Facebook dans son navigateur** (capture à
l'appui) et disposait de cookies exportés. Cela ne change rien :

- Facebook lie la session à une empreinte de navigateur (en-têtes, ordre
  TLS, exécution JavaScript). Un appel `curl` ou `gallery-dl` présentant
  le même cookie est reconnu comme un client différent et refusé.
- C'est vérifié : `facebook.com/rfi.afrique/photos` renvoie `AuthRequired`
  **avec** un fichier de cookies présent et transmis.

---

## 3. L'API officielle : possible, mais hors d'atteinte en pratique

Lire les publications d'une page qu'on ne possède pas exige la permission
**Page Public Content Access**, elle-même soumise à l'App Review de Meta :

- création d'une application développeur, puis **vérification
  d'entreprise** ;
- **plusieurs semaines** de délai ;
- Meta exige une démonstration vidéo prouvant que la donnée est
  *visiblement utilisée* dans une interface — les refus sont fréquents,
  y compris pour des usages légitimes ;
- avant approbation, une application ne peut lire que les pages dont
  **le même compte est à la fois admin de la page et de l'application**.

Autrement dit : accessible à une entreprise avec un service juridique,
pas à un studio autonome. Et cela ne donnerait toujours **aucune vidéo
téléchargeable**, seulement des métadonnées et des URL d'images.

---

## 4. Les équivalents testés

| plateforme | accès sans session | verdict |
|---|---|---|
| **Instagram** | ❌ `NotFoundError` sur 4 comptes de presse réels | même verrou que Facebook (même propriétaire) |
| **TikTok** | ❌ `No working app info is available` | nécessite une session |
| **X / Twitter** | ❌ `AuthRequired` | cookies obligatoires |
| **Mastodon** | ⚠️ ouvert, mais 1 à 4 médias par hashtag | volume insuffisant |
| **Bluesky** | ⚠️ HTTP 403 depuis une IP datacenter | à retester en résidentiel |

Instagram et TikTok appartiennent au même verrou : Meta et ByteDance ont
fermé l'accès anonyme entre 2023 et 2025.

---

## 5. Ce qui couvre réellement le besoin

Le besoin n'est pas « accéder à Facebook » : c'est **obtenir des visuels
d'actualité sur le sujet traité**. Trois sources y répondent, sans session
ni expiration.

### Presse africaine en RSS — 9 flux + presse nationale
Les rédactions publient leurs photos librement. Mesuré sur
« Guinée Conakry actualité » : **100 articles sur 26 médias**.

Ce sont exactement les pages Facebook qu'on viserait — RFI, TV5 Monde,
Guinée7, Jeune Afrique — mais accessibles directement.

### YouTube — débloqué le 21/08/2026
Le HTTP 403 venait du **client déclaré**, pas de l'IP ni des cookies.
Avec `player_client=android` : `3 clips + 4 thumbnails` sur un sujet
guinéen, dont « De nombreux tirs retentissent dans la capitale
guinéenne ». C'est du contenu publié par des gens, exactement ce que
Facebook était censé apporter.

### Pexels + Pixabay vidéo
Deux banques opérationnelles, vérifiées : 500 vidéos sur
« african market », 204 sur « african parliament », du 4K disponible.

---

## 6. Position

Facebook reste techniquement inaccessible à un studio autonome. Nous ne
cherchons pas à contourner ses protections : ce serait la même mauvaise
foi que l'obfuscation Content ID, refusée depuis le début du projet.

Si Meta ouvre un jour une recherche exploitable, la réintégration
demanderait une seule ligne dans `batchSource.js` — les cookies sont déjà
gérés par `cookieArgs()`.
