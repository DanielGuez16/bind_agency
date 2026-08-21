/**
 * Ce qui manque avant que les créatrices voient le salon, sur l'écran du matin.
 *
 * **« On ne sait pas à quoi ça sert » — parce que ce n'était pas un écran.** La
 * mise en ligne était un onglet, avec un titre à comprendre et une page à
 * traverser. Ce qu'elle portait est un état : une liste de ce qui manque, qui
 * n'a d'utilité que là où le salon regarde déjà, et qui doit disparaître une
 * fois remplie.
 *
 * **Sur encre, et c'est mesuré.** C'est la seule chose de l'écran qui demande
 * une action, et sur une journée qui n'a encore rien à montrer le contraste de
 * surface fait le travail qu'un titre ne ferait pas. Les encres claires du
 * système sont calibrées pour ce fond — `ink.onDark` porte 16,71:1 dessus.
 *
 * **Ce qui est déjà fait tient en une ligne, en pied**, plutôt qu'en quatre
 * coches qui diluent les deux qui restent. Le compte le dit — « 4 sur 6 » — et
 * l'énumération se réserve à ce qui manque.
 *
 * **Ce que la planche demande et que le serveur ne permet pas.** Elle veut que
 * le bandeau « s'efface au dernier point coché », puis devienne une ligne de
 * confirmation qui disparaît au bout de sept jours. Publier est un appel
 * explicite — `activerLeCommerce` — donc le dernier point coché ne publie pas :
 * il rend la publication *possible*. Le bandeau porte alors l'action, sans le
 * mot « go live » que la planche retire du produit. Et la ligne de confirmation
 * n'est pas rendue : elle demanderait une date de publication pour la règle des
 * sept jours, et la portée locale sur la journée pour écrire « 41 créatrices
 * peuvent vous réserver ». Ni l'une ni l'autre n'est servie. Voir `TASKS.md`.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { useApi, type VueDActivation } from '../../api';
import { Button, Icone, StatusMessage, Texte } from '../../components';
import { useI18n } from '../../i18n';
import { radius, useColors } from '../../theme';
import { miseEnLigne } from './miseEnLigne';

/** Le libellé de chaque étape. La même table que l'écran qu'il remplace. */
const LIBELLES: Record<string, string> = {
  address: 'commerce.etapeAddress',
  coordinates: 'commerce.etapeCoordinates',
  cover_photo: 'commerce.etapeCoverPhoto',
  catalog_item: 'commerce.etapeCatalogItem',
  tier_offer: 'commerce.etapeTierOffer',
  capacity_rule: 'commerce.etapeCapacityRule',
};

export function BandeauDeMiseEnLigne({
  businessId,
  activation,
  onPublie,
}: {
  businessId: string;
  /** L'état servi. Absent, le bandeau ne se rend pas : voir `miseEnLigne`. */
  activation: VueDActivation | null | undefined;
  onPublie: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const c = useColors();
  const etat = miseEnLigne(activation);

  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  // Publié, ou état inconnu : rien. Une liste de tâches qui reste après avoir
  // été remplie est la définition d'un écran dont on ne comprend plus l'objet.
  if (etat === null || etat.forme === 'publie') return null;

  async function publier() {
    setEchec(null);
    setEnvoi(true);
    try {
      await api.activerLeCommerce(businessId);
      onPublie();
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <View
      testID="bandeau-mise-en-ligne"
      style={{
        gap: 12,
        padding: 20,
        borderRadius: radius['radius.lg'],
        backgroundColor: c['bg.inverse'],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Texte variante="type.section" couleur="ink.onDark">
            {etat.forme === 'prete'
              ? t('commerce.miseEnLignePrete')
              : // **Le nombre, pas le mot.** La planche écrit « two things
                // left » parce que sa maquette en a deux ; à trois manques la
                // phrase serait fausse. Le singulier a sa propre clé, parce
                // que `count` traverse `formaterLesNombres` et que la
                // pluralisation de la bibliothèque ne le voit plus comme un
                // nombre — même raison que sur le titre de la journée.
                etat.manquantes.length === 1
                ? t('commerce.miseEnLigneRestantUn')
                : t('commerce.miseEnLigneRestant', { count: etat.manquantes.length })}
          </Texte>
          <Texte variante="type.monoSmall" couleur="ink.onDark" testID="compte-mise-en-ligne">
            {t('commerce.activationCompte', { faites: etat.faites, total: etat.total })}
          </Texte>
        </View>
      </View>

      {/* **Seulement ce qui manque.** Les points faits se comptent, ils ne
          s'énumèrent pas : quatre coches au-dessus de deux manques diluent
          exactement ce qu'on vient lire. */}
      {etat.forme === 'incomplet' ? (
        <View style={{ gap: 6 }}>
          {etat.manquantes.map((cle) => (
            <View
              key={cle}
              testID={`manque-${cle}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: radius['radius.sm'],
                  borderWidth: 2,
                  borderColor: c['line.onDark'],
                }}
              />
              <Texte variante="type.body" couleur="ink.onDark" style={{ flex: 1 }}>
                {t(LIBELLES[cle] ?? 'etats.detailIndisponible')}
              </Texte>
            </View>
          ))}
        </View>
      ) : null}

      {echec ? <StatusMessage level="danger" body={echec} testID="echec-mise-en-ligne" /> : null}

      {etat.forme === 'prete' ? (
        <View style={{ alignSelf: 'flex-start' }}>
          {/* **Le geste reste, le mot part.** La planche retire « go live » du
              produit ; publier reste un appel explicite côté serveur, donc le
              bouton reste — sous un nom qui dit ce qui se passe. */}
          <Button
            label={t('commerce.miseEnLignePublier')}
            loading={envoi}
            onPress={() => void publier()}
            testID="publier-le-commerce"
          />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ marginTop: 3 }}>
            <Icone nom="alerte" teinte={c['ink.onDark']} taille={16} />
          </View>
          <Texte variante="type.caption" couleur="ink.onDark" style={{ flex: 1 }}>
            {t('commerce.miseEnLigneInvisible')}
          </Texte>
        </View>
      )}
    </View>
  );
}
