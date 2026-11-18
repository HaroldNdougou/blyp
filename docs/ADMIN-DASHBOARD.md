# Blyp — tableau de bord fondateur (`/admin`)

Site privé + alertes téléphone/email + récaps + rapport investisseur. Aucun contenu de message n'est jamais stocké (métadonnées uniquement).

## Mise en service (ordre)

1. **SES (af-south-1)** : vérifier l'adresse d'expédition ET l'adresse de réception (sandbox SES = destinataires vérifiés uniquement).
2. **Identifiants** (génère mot de passe haché, secret 2FA, secret de session) :
   `node aws/scripts/admin-setup.mjs --email a@…,b@… --sender no-reply@… --push-phone 6AAAAAAAA,6BBBBBBBB,6CCCCCCCC --write`
   Scanner l'URI TOTP affichée dans l'authenticator. Le mot de passe n'est affiché qu'une fois.
3. **Déploiement** : `npm run aws:build` (depuis la racine) puis `node infra/scripts/sam-deploy.mjs`. L'URL du tableau de bord sort dans les sorties de la pile (`AdminDashboardUrl`).
4. **Historique** (une fois, après le déploiement) :
   `TABLE_NAME=… AWS_REGION=af-south-1 node aws/scripts/admin-backfill.mjs --dry-run` puis sans `--dry-run`.
   Silencieux (aucune alerte), rejouable, sans doublon avec les événements en direct.
5. Mettre à jour l'app (l'alerte téléphone passe par une notification « donnée » traitée nativement).

Plusieurs fondateurs : chaque adresse peut se connecter (mêmes mot de passe + code 2FA, à ajouter dans plusieurs applis d’authentification) et reçoit tous les emails ; chaque numéro Blyp reçoit tous les push sur ses téléphones. Si une adresse ou un téléphone est indisponible, les autres reçoivent quand même.

## App mobile admin

Dossier `admin-app/` (Android + iOS). Même login que le site. Dashboard simplifié + flux en direct + push visibles. Le site reste la version détaillée (exports, actions souveraines).

Les push ne passent plus par les comptes client Blyp : uniquement les téléphones où l’app admin est connectée.

## Ce que vous voyez

- **Flux en direct** : inscriptions, connexions, ouvertures d'app, messages (type + qui → qui, jamais le texte), paiements, envois, recharges, retraits, actions admin.
- **Alertes** (push + email, réglables) : chaque événement ; retraits et recharges avec le détail complet.
- **Récaps** (Africa/Douala) : quotidien tous les jours ; hebdomadaire le lundi ; mensuel le 1er. Envoi unique (réservation en base) même si le planificateur se répète.
- **Rapport investisseur** : GMV, volume/nombre de transactions, panier moyen, utilisateurs actifs jour/semaine/mois, ratio d'adhérence, activation, rétention J1/J7/J30 par cohorte, commerçants actifs, float attendu vs réel. Export CSV et page imprimable (PDF).
- **Actions souveraines** (re-saisie mot de passe + code 2FA, validité 5 min, journal d'audit) : ajouter un utilisateur, créditer/débiter (plafond 10 000 000 FCFA, motif obligatoire, idempotent), bloquer le paiement, supprimer (archivé, solde confisqué tracé).

## Sécurité

- Mot de passe scrypt + TOTP (anti-rejeu) ; verrouillage après 5 échecs / 15 min ; liste d'IP optionnelle (`ADMIN_ALLOWED_IPS`).
- Jetons admin séparés des jetons clients (secret et audience distincts) ; cookie `HttpOnly; Secure; SameSite=Strict` ; en-tête anti-CSRF ; CSP à nonce ; sorties échappées ; export CSV protégé contre l'injection de formules.
- Le hash du PIN n'est jamais renvoyé ; secrets uniquement en variables d'environnement de la pile (à terme : Secrets Manager).
- Les envois d'événements sont « au mieux » : une panne de l'admin ne bloque jamais un paiement ou un message.

## Définitions des indicateurs

- **Jour** = jour civil Cameroun (UTC+1).
- **Utilisateur actif** = profil complet (nom + PIN) avec au moins un événement d'activité sur la période.
- **GMV** = paiements commerçants + envois entre personnes. Les recharges et retraits sont suivis à part.
- **Activation** = au moins un paiement commerçant.
- **Rétention Jn** = part de la cohorte d'inscription active n jours plus tard.
- **Historique reconstitué** : inscriptions, recharges, paiements, envois uniquement ; ouvertures, connexions et messages n'existent que depuis la mise en service.

## Limites connues

- Pas encore de parcours de retrait dans l'app : l'alerte est prête dès que l'événement `withdrawal` est émis.
- Liste utilisateurs et float parcourent la table (bornés) : prévoir un index dédié à l'échelle.
- Tests : `node --test aws/lib/admin.test.mjs aws/lib/adminHandler.test.mjs aws/lib/adminWorker.test.mjs` (sans AWS, base en mémoire). Non testé contre SES/Expo réels avant le 1er déploiement.
