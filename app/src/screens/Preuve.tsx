/**
 * Ce que le commerce doit regarder avant d'approuver.
 *
 * **Il ne voyait rien.** Le pseudonyme, la prestation, quatre motifs de refus
 * et un bouton d'approbation : on lui demandait de trancher sur un contenu
 * qu'il ne pouvait pas ouvrir. La donnée était pourtant rendue par l'API depuis
 * le début — l'écran l'ignorait.
 *
 * **Une preuve n'est pas une photo de salon.** Elle est privée : son adresse ne
 * se devine pas, elle se demande. L'écran réclame un droit de lecture court, et
 * c'est lui qui ouvre l'objet. Un échec de lecture n'est donc pas une image
 * cassée : c'est un droit qui a expiré, et on le dit.
 *
 * **Ce qui était attendu est montré à côté de ce qui a été rendu.** Une mention
 * exigée qu'il faut aller chercher ailleurs se vérifie mal, et c'est
 * exactement la vérification qu'on lui demande de faire.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useApi, type DerniereSoumission } from '../api';
import { Icone, LienExterne, Photo, SkeletonBox, StatusMessage, Texte } from '../components';
import { useI18n } from '../i18n';
import { radius, useTheme } from '../theme';

/** La hauteur de l'aperçu. Assez grand pour juger, pas pour remplir l'écran. */
const APERCU = 260;

type Etat =
  | { etat: 'chargement' }
  | { etat: 'pret'; url: string }
  | { etat: 'sans_objet' }
  | { etat: 'echec'; message: string };

export function PreuveSoumise({
  soumission,
  mentionAttendue,
  lieuAttendu,
}: {
  soumission: DerniereSoumission | null;
  mentionAttendue: string | null;
  lieuAttendu: boolean;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const { color: c } = useTheme();
  const [vue, setVue] = useState<Etat>({ etat: 'chargement' });

  const proofId = soumission?.proof_id ?? null;
  const aUnObjet = Boolean(soumission?.media_key || soumission?.screenshot_key);

  useEffect(() => {
    if (!proofId || !aUnObjet) {
      setVue({ etat: 'sans_objet' });
      return;
    }

    let vivant = true;
    setVue({ etat: 'chargement' });
    void api
      .droitDeLireLaPreuve(proofId)
      .then((droit) => {
        if (vivant) setVue({ etat: 'pret', url: droit.url });
      })
      .catch((erreur) => {
        // Dit, jamais avalé : une image absente sans explication se lit comme
        // une panne du produit, et c'est le moment où l'on approuve à
        // l'aveugle pour en finir.
        if (vivant) setVue({ etat: 'echec', message: messageDErreur(erreur) });
      });
    return () => {
      vivant = false;
    };
  }, [api, aUnObjet, messageDErreur, proofId]);

  if (soumission === null) {
    return (
      <StatusMessage
        level="neutral"
        body={t('commerce.preuveAbsente')}
        testID="preuve-absente"
      />
    );
  }

  return (
    <View style={{ gap: 8 }} testID="preuve-soumise">
      <View
        style={{
          height: APERCU,
          borderRadius: radius['radius.lg'],
          overflow: 'hidden',
          backgroundColor: c['media.placeholder'],
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {vue.etat === 'chargement' ? <SkeletonBox width={200} height={APERCU} /> : null}
        {/* **`Photo`, et non une `Image` posée à la main.** Même raison qu'à
            l'envoi : le fondu, l'aplat des médias et le mouvement réduit
            viennent du composant, pas de chaque écran. */}
        {vue.etat === 'pret' ? (
          <Photo
            uri={vue.url}
            hauteur={APERCU}
            cadrage="contain"
            style={{ width: '100%' }}
            testID="apercu-de-la-preuve"
          />
        ) : null}
        {vue.etat === 'sans_objet' ? (
          <View style={{ alignItems: 'center', gap: 6, padding: 16 }} testID="preuve-sans-objet">
            <Icone nom="image" couleur="ink.mute" taille={28} />
            <Texte variante="type.caption" couleur="ink.soft" align="center">
              {t('commerce.preuveSansImage')}
            </Texte>
          </View>
        ) : null}
        {vue.etat === 'echec' ? (
          <View style={{ padding: 16 }} testID="preuve-illisible">
            <StatusMessage level="warning" body={vue.message} />
          </View>
        ) : null}
      </View>

      {/* L'adresse d'origine, quand elle existe : c'est là que la publication
          se vérifie vraiment, l'archive n'en est que la trace. */}
      {soumission.source_url ? (
        <LienExterne
          url={soumission.source_url}
          accessibilityLabel={t('commerce.preuveOuvrirSource')}
          testID="ouvrir-la-publication"
        >
          <Texte variante="type.caption" couleur="brand.700">
            {t('commerce.preuveOuvrirSource')}
          </Texte>
        </LienExterne>
      ) : null}

      {/* Ce qui était exigé, à côté de ce qui a été rendu. La détection
          automatique n'existe pas encore : on montre l'exigence, on ne prétend
          pas l'avoir vérifiée. */}
      {mentionAttendue || lieuAttendu ? (
        <View style={{ gap: 4 }} testID="ce-qui-etait-attendu">
          <Texte variante="type.label" couleur="ink.soft">
            {t('commerce.preuveAttendu')}
          </Texte>
          {mentionAttendue ? (
            <Texte variante="type.caption" couleur="ink.soft">
              {t('commerce.preuveMention', { mention: mentionAttendue })}
            </Texte>
          ) : null}
          {lieuAttendu ? (
            <Texte variante="type.caption" couleur="ink.soft">
              {t('commerce.preuveLieu')}
            </Texte>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Le squelette de la vignette, à la géométrie de ce qui arrive. */
export function SqueletteDePreuve() {
  return <SkeletonBox width={320} height={APERCU} />;
}

export { APERCU as HAUTEUR_APERCU };
