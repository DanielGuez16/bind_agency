/**
 * La première porte d'un commerce : celle qui n'existait pas.
 *
 * **Le défaut que cet écran répare.** `POST /business` est là depuis la
 * première phase, et rien ne l'appelait. Un gérant qui s'inscrivait seul
 * arrivait sur un onglet « Aujourd'hui » vide, sans action, et y restait : le
 * seul moyen d'exister était qu'on lui prépare une fiche depuis le mode
 * terrain. Un produit à deux côtés dont un côté ne peut pas s'inscrire n'a pas
 * de côté commerce, il a une liste d'invités.
 *
 * **Quatre champs, pas dix.** La fiche complète — horaires, catalogue, photos,
 * paliers — se remplit ensuite, dans la configuration, écran par écran, avec
 * les étapes d'activation qui disent ce qu'il reste. Demander tout ici ferait
 * un formulaire qu'on abandonne à la moitié, et l'activation refuserait quand
 * même tant que le catalogue est vide. Ce qu'on demande est le minimum qui
 * rende le commerce *localisable* : un nom, une catégorie, une adresse.
 *
 * **La catégorie se choisit, l'adresse se géocode.** La catégorie classe le
 * commerce dans le fil et dans les compteurs par rayon ; la deviner serait la
 * deviner pour tout le monde. L'adresse, elle, part au géocodeur côté serveur :
 * sans elle, le commerce n'apparaît dans aucun rayon et son fil est vide.
 * L'écran le dit plutôt que de le laisser découvrir.
 *
 * **La devise n'est pas un champ.** Elle est immuable après création — des
 * montants historiques changeraient de sens — et le lancement est à Miami. La
 * proposer reviendrait à offrir une décision irréversible à quelqu'un qui n'a
 * pas les éléments pour la prendre. Le mode terrain fait déjà ce choix-là.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { useApi, type BusinessCategory } from '../api';
import { Button, Chip, RangeeDeChips, StatusMessage, TextField, Texte } from '../components';
import { useI18n } from '../i18n';

/**
 * Les catégories offertes, dans l'ordre où elles sont proposées.
 *
 * `other` en dernier et non en premier : une liste qui s'ouvre sur « autre »
 * invite à ne pas lire les cinq qui suivent, et un commerce mal classé ne
 * remonte dans aucun filtre.
 */
const CATEGORIES: BusinessCategory[] = [
  'beauty',
  'fitness',
  'restaurant',
  'museum',
  'family_activity',
  'other',
];

/**
 * La devise du lancement. Immuable une fois posée, donc décidée ici et non
 * demandée — voir l'en-tête. Le mode terrain pose la même.
 */
const DEVISE = 'USD';

export type CreationDuCommerceProps = {
  /** Rejoué quand le commerce existe : c'est ce qui fait apparaître les onglets. */
  onCree: () => void;
};

/**
 * Le corps de l'écran, sans son enveloppe.
 *
 * Il est rendu dans l'état vide de l'`Ecran` d'attente, qui porte déjà le
 * titre, le liseré du rôle, la marge et le défilement. Se donner un `flex: 1`
 * et un fond ici les doublerait — et un formulaire qui ne défile pas coupe son
 * bouton sous le clavier dès le premier champ touché.
 */
export function CreationDuCommerceScreen({ onCree }: CreationDuCommerceProps) {
  const { t } = useI18n();
  const { api, messageDErreur } = useApi();

  const [nom, setNom] = useState('');
  const [categorie, setCategorie] = useState<BusinessCategory>('beauty');
  const [adresse, setAdresse] = useState('');
  const [telephone, setTelephone] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  async function creer() {
    setEchec(null);
    setEnCours(true);
    try {
      await api.creerMonCommerce({
        name: nom.trim(),
        category: categorie,
        currency: DEVISE,
        address: adresse.trim() || null,
        phone: telephone.trim() || null,
      });
      onCree();
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
      // Le formulaire garde sa saisie : un refus du serveur — une adresse
      // introuvable, un nom trop long — ne doit pas coûter de la retaper.
    } finally {
      setEnCours(false);
    }
  }

  return (
    // Pas de titre ici : `Ecran` le porte déjà, dans la barre de titre en grand
    // écran et en tête de flux en compact. L'écrire aussi donnerait « Create
    // your business » au-dessus de « Create your business ».
    <View testID="creation-du-commerce" style={{ gap: 16 }}>
      <Texte variante="type.body" couleur="ink.soft">
        {t('creationCommerce.corps')}
      </Texte>

      {echec ? (
        <StatusMessage level="danger" body={echec} testID="echec-creation-commerce" />
      ) : null}

      <TextField
        label={t('creationCommerce.nom')}
        value={nom}
        onChangeText={setNom}
        testID="champ-nom-du-commerce"
      />

      <View style={{ gap: 8 }}>
        <Texte variante="type.label" couleur="ink.soft">
          {t('creationCommerce.categorie')}
        </Texte>
        <RangeeDeChips>
          {CATEGORIES.map((valeur) => (
            <Chip
              key={valeur}
              label={t(`categories.${valeur}`)}
              selected={categorie === valeur}
              onPress={() => setCategorie(valeur)}
              testID={`categorie-${valeur}`}
            />
          ))}
        </RangeeDeChips>
      </View>

      <TextField
        label={t('creationCommerce.adresse')}
        helpText={t('creationCommerce.adresseAide')}
        value={adresse}
        onChangeText={setAdresse}
        testID="champ-adresse-du-commerce"
      />
      <TextField
        label={t('creationCommerce.telephone')}
        value={telephone}
        onChangeText={setTelephone}
        keyboard="numeric"
        testID="champ-telephone-du-commerce"
      />

      <Button
        label={t('creationCommerce.creer')}
        onPress={() => void creer()}
        disabled={nom.trim().length === 0}
        loading={enCours}
        loadingLabel={t('creationCommerce.creation')}
        testID="creer-le-commerce"
      />

      {/* Ce qui vient après. Un formulaire qui ne dit pas où il mène laisse
          croire que le commerce sera en ligne au clic — il ne le sera pas, et
          l'activation attend six étapes de plus. */}
      <Texte variante="type.caption" couleur="ink.mute">
        {t('creationCommerce.ensuite')}
      </Texte>
    </View>
  );
}
