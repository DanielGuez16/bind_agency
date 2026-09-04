/**
 * Ce qu'une créatrice dit d'elle-même.
 *
 * **La route existait, l'écran non — et c'est ce qui rendait le champ vide
 * partout.** `PATCH /me/profile` accepte ces quatre champs depuis que le profil
 * existe, avec onze tests derrière ; rien côté client ne l'appelait. La
 * conséquence n'était pas « un écran manquant », c'était `bio` et `city` nulles
 * pour toutes les créatrices, y compris celles de la démonstration — donc un
 * annuaire qui n'avait rien à montrer même le jour où on déciderait de montrer.
 *
 * **Cinq champs, et deux décident.** La bio est la ligne où une créatrice
 * dit ce qu'elle fait plutôt que ce qu'elle est ; les centres d'intérêt disent
 * la même chose sous une forme que le salon peut filtrer, ce qu'une phrase
 * libre ne permet pas.
 *
 * **Le reste ne paraît nulle part devant un salon.** Le prénom et le nom ne
 * paraissent nulle part devant un salon — l'annuaire titre le pseudonyme, et
 * l'état civil n'arrive qu'à la réservation. La ville situe. La bio est la
 * seule ligne où une créatrice dit ce qu'elle fait plutôt que ce qu'elle est,
 * et c'est celle qu'un salon lit pour décider.
 *
 * **Aucune de ces informations n'est obligatoire, et rien ne le rappelle.** Un
 * profil vide est un état normal : le produit ne fait dépendre aucun palier ni
 * aucune réservation de ces champs. Ajouter « recommandé » ou un compteur de
 * complétion en ferait une dette morale sans contrepartie.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { useApi, type CentreDInteret, type MonProfilDeclare as Profil } from '../../api';
import { Button, SkeletonLignes, StatusMessage, TextField, Texte } from '../../components';
import { useI18n } from '../../i18n';
import { ChoixDesInterets } from '../interets/ChoixDesInterets';
import { INTERETS_MAXIMUM } from '../interets/liste';
import { useRequete } from '../useRequete';

/**
 * La longueur que le serveur accepte pour la bio.
 *
 * **Recopiée du schéma Pydantic, et éprouvée contre lui.** `TextField` la pose
 * sur `maxLength`, ce qui empêche de dépasser plutôt que de rendre un 422 après
 * coup ; mais une borne cliente qui dérive de la borne serveur laisse écrire un
 * texte que l'envoi refuse. Le test la compare à `creator_profile.py`, comme
 * `NOTE_MAXIMUM` l'est déjà à `config.py`.
 */
export const BIO_MAXIMUM = 1000;

/** Les bornes des trois champs courts, mêmes valeurs que `StringConstraints`. */
export const NOM_MAXIMUM = 100;
export const VILLE_MAXIMUM = 120;

/**
 * Ce qui part au serveur : la chaîne vide devient `null`.
 *
 * **Vider un champ l'efface, et c'est le seul geste qui l'efface.** Le serveur
 * traite déjà `""` comme une absence — `_vide_vaut_absent` dans le schéma —
 * mais il le fait pour se protéger, pas pour nous dispenser de le dire. Sans
 * cette conversion, l'écran croirait avoir écrit une chaîne vide là où le
 * serveur a rangé un `null`, et le bouton d'enregistrement resterait offert
 * après un enregistrement réussi.
 */
export function aEnvoyer(saisi: Profil): Profil {
  const nettoyer = (valeur: string | null) => {
    const propre = (valeur ?? '').trim();
    return propre.length === 0 ? null : propre;
  };
  return {
    first_name: nettoyer(saisi.first_name),
    last_name: nettoyer(saisi.last_name),
    city: nettoyer(saisi.city),
    bio: nettoyer(saisi.bio),
    // **La liste vide part en `null`, jamais en `[]`.** Le serveur ramène
    // déjà l'une à l'autre — le validateur du schéma le fait — mais compter
    // dessus laisserait l'écran croire avoir écrit `[]` là où la base porte
    // `null`, et le bouton d'enregistrement resterait offert après un
    // enregistrement réussi. C'est le défaut que `nettoyer` évite déjà aux
    // quatre champs texte, appliqué au cinquième.
    interests: (saisi.interests ?? []).length === 0 ? null : (saisi.interests ?? []),
  };
}

/**
 * La section des réglages : elle lit le profil, puis le donne au formulaire.
 *
 * **Séparée du formulaire, et c'est ce qui rend le formulaire testable.** Le
 * formulaire reçoit un profil déjà chargé et ne connaît que l'écriture ; la
 * lecture, ses trois états et son rechargement vivent ici. Les monter ensemble
 * obligerait chaque test du formulaire à simuler un `GET` pour éprouver un
 * `PATCH`.
 *
 * **Rien tant qu'on ne sait pas.** Le formulaire n'est pas monté avec des
 * champs vides pendant le chargement : une créatrice qui verrait sa bio
 * apparaître après coup croirait l'avoir perdue. Même raison que la pause du
 * commerce, qui ne propose rien avant de savoir dans quel état est la vitrine.
 */
export function SectionDeMonProfil() {
  const { t } = useI18n();
  const { api } = useApi();

  const requete = useRequete<Profil>((signal) => api.monProfil(signal), {
    estVide: () => false,
  });

  return (
    <View style={{ gap: 10 }} testID="section-mon-profil">
      <Texte variante="type.label" couleur="ink.soft">
        {t('profil.declareTitre')}
      </Texte>
      {requete.etat === 'chargement' ? (
        <SkeletonLignes combien={3} testID="squelette-mon-profil" />
      ) : null}
      {requete.etat === 'pret' ? (
        <MonProfilDeclare profil={requete.donnees} onChange={requete.recharger} />
      ) : null}
      {/* **L'échec se dit et ne bloque rien d'autre.** Cette section vit au
          milieu d'un écran de réglages : y rendre l'état d'erreur d'`Ecran`
          masquerait la déconnexion et la suppression, qui n'ont rien à voir
          avec elle. */}
      {requete.etat === 'erreur' ? (
        <StatusMessage
          level="warning"
          body={t('profil.declareIllisible')}
          action={{
            label: t('common.retry'),
            onPress: requete.recharger,
            variant: 'secondary',
          }}
          testID="profil-illisible"
        />
      ) : null}
    </View>
  );
}

/**
 * Deux listes d'intérêts portent-elles la même chose.
 *
 * **Dans l'ordre, et c'est voulu.** L'ordre est celui des gestes de la
 * créatrice, le serveur le conserve, et le rendre indifférent ferait passer
 * un réarrangement pour « rien n'a changé » alors que ce qu'elle relira au
 * prochain chargement aurait bougé.
 */
export function memesInterets(
  a: CentreDInteret[] | null,
  b: CentreDInteret[] | null,
): boolean {
  const gauche = a ?? [];
  const droite = b ?? [];
  return (
    gauche.length === droite.length && gauche.every((valeur, rang) => valeur === droite[rang])
  );
}

export function MonProfilDeclare({
  profil,
  onChange,
}: {
  profil: Profil;
  /** Rejoué après un enregistrement : l'appelant relit ce qu'il a affiché. */
  onChange: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const [saisi, setSaisi] = useState<Profil>(profil);
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  const propre = aEnvoyer(saisi);
  const change =
    propre.first_name !== profil.first_name ||
    propre.last_name !== profil.last_name ||
    propre.city !== profil.city ||
    propre.bio !== profil.bio ||
    // Comparée par son contenu et dans l'ordre : deux tableaux distincts ne
    // sont jamais `===`, et s'arrêter à l'identité rendrait le bouton offert
    // en permanence dès que l'écran est monté.
    !memesInterets(propre.interests, profil.interests);

  async function enregistrer() {
    setEchec(null);
    setEnvoi(true);
    try {
      await api.mettreAJourMonProfil(propre);
      onChange();
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <View style={{ gap: 12 }} testID="mon-profil-declare">
      {/* **Qui lit quoi, dit avant les champs.** Une créatrice qui écrit une
          bio sans savoir où elle atterrit écrit soit trop, soit rien. La
          phrase nomme le lecteur — les salons — parce que c'est la seule
          information qui change ce qu'on tape. */}
      <Texte variante="type.caption" couleur="ink.soft" testID="profil-qui-lit">
        {t('profil.declareQuiLit')}
      </Texte>

      <TextField
        label={t('profil.declarePrenom')}
        value={saisi.first_name ?? ''}
        onChangeText={(v) => setSaisi((avant) => ({ ...avant, first_name: v }))}
        maxLength={NOM_MAXIMUM}
        testID="champ-prenom"
      />
      <TextField
        label={t('profil.declareNom')}
        value={saisi.last_name ?? ''}
        onChangeText={(v) => setSaisi((avant) => ({ ...avant, last_name: v }))}
        maxLength={NOM_MAXIMUM}
        testID="champ-nom"
      />
      <TextField
        label={t('profil.declareVille')}
        value={saisi.city ?? ''}
        onChangeText={(v) => setSaisi((avant) => ({ ...avant, city: v }))}
        placeholder={t('profil.declareVillePlaceholder')}
        maxLength={VILLE_MAXIMUM}
        testID="champ-ville"
      />
      {/* Quatre lignes : de quoi écrire trois phrases sans que le champ
          devienne une page. La borne serveur est à mille caractères ; ce que
          l'écran suggère par sa hauteur est bien plus court, et c'est voulu. */}
      <TextField
        label={t('profil.declareBio')}
        value={saisi.bio ?? ''}
        onChangeText={(v) => setSaisi((avant) => ({ ...avant, bio: v }))}
        placeholder={t('profil.declareBioPlaceholder')}
        helpText={t('profil.declareBioAide')}
        lignes={4}
        maxLength={BIO_MAXIMUM}
        testID="champ-bio"
      />

      {/* **Après la bio, et non avant.** La bio est la phrase qu'on écrit ;
          les intérêts sont ce qu'on en retient pour filtrer. Les proposer en
          premier ferait cocher avant de réfléchir, et la bio finirait par les
          répéter. */}
      <View style={{ gap: 6 }}>
        <Texte variante="type.label">{t('profil.declareInterets')}</Texte>
        <ChoixDesInterets
          choisis={saisi.interests ?? []}
          onChange={(suivants) =>
            setSaisi((avant) => ({ ...avant, interests: suivants }))
          }
          maximum={INTERETS_MAXIMUM}
          aide={t('profil.declareInteretsAide')}
          testID="champ-interets"
        />
      </View>

      {echec ? <StatusMessage level="danger" body={echec} testID="echec-du-profil" /> : null}

      {/* Le bouton ne paraît qu'une fois quelque chose changé, comme sur les
          liens du salon : un enregistrement toujours offert fait douter de ce
          qui est enregistré. */}
      {change ? (
        <View style={{ flexDirection: 'row' }}>
          <Button
            label={t('composition.enregistrer')}
            loading={envoi}
            fullWidth={false}
            onPress={() => void enregistrer()}
            testID="enregistrer-mon-profil"
          />
        </View>
      ) : null}
    </View>
  );
}
