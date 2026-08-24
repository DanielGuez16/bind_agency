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
 * **Deux points de la planche sont tranchés contre elle, et pour de bon.**
 *
 * Elle veut que le bandeau « s'efface au dernier point coché ». Il ne s'efface
 * pas : **le dernier point rend la publication possible, il ne la déclenche
 * pas.** Un salon choisit le moment où il apparaît — c'est la seule décision
 * du produit qui expose un commerce à des inconnus, et elle ne se prend pas
 * par ricochet en cochant une case de capacité. Le bandeau porte donc l'action,
 * sous un nom qui n'est pas « go live », et il **dit** que rien ne part tout
 * seul : la confusion a lieu au moment exact où tout est vert et où rien ne
 * s'est passé.
 *
 * Elle veut ensuite qu'il devienne une ligne de confirmation — « vous êtes en
 * ligne · 41 créatrices peuvent vous réserver » — qui disparaît au bout de sept
 * jours. **Il ne le devient pas.** Les deux données manquent : aucune date de
 * publication n'est servie, donc la règle des sept jours n'a pas d'origine, et
 * la portée locale ne vit que sur les rapports. Une ligne qui affirmerait l'une
 * ou l'autre à l'estime serait une confirmation fausse, ce qui est pire que
 * l'absence de confirmation. Le bandeau s'efface simplement.
 *
 * Voir `DECISIONS.md`, 2026-08-23.
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

  // Publié et complet, ou état inconnu : rien. Une liste de tâches qui reste
  // après avoir été remplie est la définition d'un écran dont on ne comprend
  // plus l'objet — mais « publié et invisible » n'est pas rempli.
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
            {etat.forme === 'publie-mais-invisible'
              ? t('commerce.miseEnLigneInvisibleTitre')
              : etat.forme === 'prete'
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
          {/* Le compte n'a de sens qu'avant la publication : après, ce n'est
              plus une progression, c'est un manque. */}
          {etat.forme !== 'publie-mais-invisible' ? (
            <Texte variante="type.monoSmall" couleur="ink.onDark" testID="compte-mise-en-ligne">
              {t('commerce.activationCompte', { faites: etat.faites, total: etat.total })}
            </Texte>
          ) : null}
        </View>
      </View>

      {/* **Seulement ce qui manque.** Les points faits se comptent, ils ne
          s'énumèrent pas : quatre coches au-dessus de deux manques diluent
          exactement ce qu'on vient lire. */}
      {etat.forme === 'incomplet' || etat.forme === 'publie-mais-invisible' ? (
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
        <View style={{ gap: 10 }}>
          {/* **Le dernier point coché ne publie pas, et l'écran le dit.** La
              planche suppose que le bandeau « s'efface au dernier point
              coché » ; c'est le seul endroit du produit où la confusion coûte
              quelque chose, parce qu'elle a lieu au moment exact où tout est
              vert et où rien ne s'est passé. Un salon qui croit être en ligne
              ne le vérifie pas.

              La phrase vient après le compte et avant le bouton : elle répond
              à « pourquoi ne suis-je pas visible » juste avant d'offrir le
              geste qui y répond. */}
          <Texte
            variante="type.caption"
            couleur="ink.onDark"
            testID="publication-explicite"
          >
            {t('commerce.miseEnLigneVousChoisissez')}
          </Texte>
          {/* **Le geste reste, le mot part.** La planche retire « go live » du
              produit ; publier reste un appel explicite côté serveur, donc le
              bouton reste — sous un nom qui dit ce qui se passe. */}
          <View style={{ alignSelf: 'flex-start' }}>
          <Button
            label={t('commerce.miseEnLignePublier')}
            loading={envoi}
            onPress={() => void publier()}
            testID="publier-le-commerce"
          />
          </View>
        </View>
      ) : etat.forme === 'publie-mais-invisible' ? null : (
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
