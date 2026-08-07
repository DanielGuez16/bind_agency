/**
 * 02a · Paliers accessibles, et 02b · éligible à rien.
 *
 * **L'écran dit d'abord ce qu'est un palier.** Il ne le disait pas : il
 * énumérait « Story · Instagram · Ouvert », ce qui se lit comme une liste de
 * publications passées et non comme un droit d'accès. Une phrase en tête donne
 * la règle du jeu — plus le format engagé est exigeant, plus ce qu'il ouvre est
 * généreux — et chaque carte la décline sur son cas.
 *
 * **Chaque palier dit ce qu'il donne, pas seulement son état.** Ce à quoi on
 * s'engage, et combien de prestations cela ouvre. Un état sans contrepartie ni
 * gain ne se relie à rien de ce qu'on peut faire.
 *
 * **Tous les paliers actifs sont affichés**, ouverts ou non. Un créateur qui
 * débute verrait sinon un écran vide sans rien savoir de ce qui l'attend.
 * C'est l'inverse du fil, où un palier fermé encombre ; ici il oriente.
 *
 * **Tous les obstacles sont rendus, dans l'ordre du serveur.** N'en montrer
 * qu'un ferait combler le premier pour découvrir le second, puis le troisième.
 * Ils sont annoncés par « Pour l'ouvrir » : une liste de manques sans titre se
 * lit comme une liste de reproches.
 *
 * **L'écart n'est chiffré qu'à partir de 60 % du seuil.** En dessous, horizon :
 * le seuil, et rien d'autre. Aucune projection de rythme.
 *
 * **Sans compte social, l'écran ne montre pas six portes fermées.** Il dit que
 * tout part de là et propose de le faire. C'est le seul cas où une carte passe
 * devant les paliers.
 */
import { View } from 'react-native';

import { useApi, type PalierAccessible, type VueDesPaliers } from '../api';
import {
  Apparition,
  Button,
  Chip,
  EnTeteDEcran,
  Filet,
  Icone,
  LigneDeContrepartie,
  StatusMessage,
  Texte,
  TierBadge,
} from '../components';
import { useI18n } from '../i18n';
import { en } from '../i18n/en';
import { useTheme } from '../theme';
import { Ecran } from './Ecran';
import { messageDObstacle, nomDePlateforme } from './obstacle';
import { useRequete } from './useRequete';

const CODES_CONNUS = new Set(Object.keys(en.errors));

/** L'obstacle qui ne se règle pas en gagnant des abonnés : il n'y a pas de compte. */
const AUCUN_COMPTE = 'no_social_account';

export function PaliersScreen({
  prenom = null,
  onConnecterUnReseau,
}: {
  /**
   * Le prénom, résolu par la coquille.
   *
   * L'écran ne lit pas la session lui-même : il deviendrait impossible à
   * monter sans elle, et c'est le genre de dépendance qui se propage d'un
   * écran au suivant jusqu'à ce que plus rien ne se teste isolément.
   */
  prenom?: string | null;
  /** Mène là où l'on rattache un réseau. Absent chez qui n'y a pas accès. */
  onConnecterUnReseau?: () => void;
}) {
  const { api } = useApi();
  const { t } = useI18n();

  const requete = useRequete<VueDesPaliers>((signal) => api.mesPaliers(signal), {
    // Vide veut dire « aucun palier configuré », un cas de plateforme. Un
    // créateur sans accès n'est **pas** vide : il a des paliers à lire, tous
    // fermés, et c'est justement l'écran qui doit le lui expliquer.
    estVide: (vue) => vue.paliers.length === 0,
  });

  return (
    <Ecran
      requete={requete}
      testID="ecran-paliers"
      entete={
        <EnTeteDEcran
          titre={t('parcours.tiersTitre')}
          surtitre={prenom ? t('tiers.greeting', { prenom }) : null}
          testID="entete-paliers"
        />
      }
      vide={<StatusMessage level="neutral" body={t('parcours.tiersVide')} />}
    >
      {(vue) => {
        // Aucun compte rattaché : le moteur n'a rien à évaluer, et tous les
        // paliers portent le même obstacle. Six cartes fermées pour une seule
        // cause donnent six fois la même mauvaise nouvelle.
        const sansCompte = vue.paliers.every((palier) =>
          palier.obstacles.some((obstacle) => obstacle.raison === AUCUN_COMPTE),
        );

        return (
          <View style={{ gap: 14 }}>
            {sansCompte ? (
              <CarteDeConnexion onConnecter={onConnecterUnReseau} />
            ) : (
              <Apparition>
                <Texte variante="type.body" couleur="text.secondary" testID="principe">
                  {t('tiers.principe')}
                </Texte>
              </Apparition>
            )}

            {vue.is_new_creator ? (
              <Apparition rang={1}>
                <StatusMessage
                  level="neutral"
                  title={t('tiers.newCreatorBadge')}
                  body={t('tiers.newCreatorHelp')}
                  testID="badge-nouveau"
                />
              </Apparition>
            ) : null}

            {vue.paliers.map((palier, rang) => (
              <Apparition key={palier.tier_id} rang={rang + 2}>
                <CartePalier palier={palier} />
              </Apparition>
            ))}
          </View>
        );
      }}
    </Ecran>
  );
}

/**
 * Le point de départ, quand aucun réseau n'est rattaché.
 *
 * En haut et non en bas : c'est la seule chose à faire, et la faire suivre six
 * paliers fermés reviendrait à expliquer l'échec avant la sortie.
 */
function CarteDeConnexion({ onConnecter }: { onConnecter?: () => void }) {
  const { color: c } = useTheme();
  const { t } = useI18n();

  return (
    <Apparition>
      <View
        testID="palier-sans-compte"
        style={{
          gap: 10,
          padding: 16,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: c['accent.subtle'],
          backgroundColor: c['accent.subtle'],
        }}
      >
        <Icone nom="etincelle" couleur="accent.default" taille={28} />
        <Texte variante="type.heading">{t('tiers.connectTitle')}</Texte>
        <Texte variante="type.body" couleur="text.secondary">
          {t('tiers.connectBody')}
        </Texte>
        {onConnecter ? (
          <Button
            label={t('tiers.connectAction')}
            onPress={onConnecter}
            testID="aller-connecter-un-reseau"
          />
        ) : null}
      </View>
    </Apparition>
  );
}

function CartePalier({ palier }: { palier: PalierAccessible }) {
  const { color: c } = useTheme();
  const { t } = useI18n();

  const ouvert = palier.accessible;
  // Le palier teinte sa propre carte. Trois teintes distinctes valent mieux
  // qu'un cadre identique répété six fois, où seul le mot change.
  const teinte = `tier.${palier.content_format}` as const;

  return (
    <View
      testID={`palier-${palier.tier_id}`}
      style={{
        gap: 10,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: ouvert ? c[teinte] : c['border.subtle'],
        backgroundColor: c['bg.surface'],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <TierBadge tier={palier.content_format} />
        {/* La plateforme, en clair. Sans elle, six paliers portent trois
            libellés répétés deux fois, et « story fermé » juste sous « story
            ouvert » se lit comme une contradiction. */}
        <Chip label={nomDePlateforme(palier.platform)} />
        <View style={{ flex: 1 }} />
        <Chip label={ouvert ? t('parcours.tiersOuvert') : t('parcours.tiersFerme')} />
      </View>

      {/* Ce à quoi on s'engage. */}
      <View style={{ gap: 2 }}>
        <Texte variante="type.caption" couleur="text.muted">
          {t('tiers.counterpart')}
        </Texte>
        <LigneDeContrepartie tier={palier.content_format} />
      </View>

      {/* Ce que cela ouvre. C'est la moitié manquante : un état sans gain ne
          dit pas pourquoi on voudrait franchir le palier. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icone nom="cadenas" couleur={ouvert ? teinte : 'text.muted'} taille={18} />
        <Texte
          variante="type.bodyStrong"
          couleur={ouvert ? teinte : 'text.secondary'}
          testID={`ouvre-${palier.tier_id}`}
          style={{ flex: 1 }}
        >
          {palier.offres_disponibles === 0
            ? t('tiers.opensNone')
            : palier.offres_disponibles === 1
              ? t('tiers.opensOne')
              : t('tiers.opens', { count: palier.offres_disponibles })}
        </Texte>
      </View>

      {palier.obstacles.length > 0 ? (
        <>
          <Filet />
          <Texte variante="type.label" couleur="text.secondary">
            {t('tiers.toUnlock')}
          </Texte>
          {/* Tous les obstacles, dans l'ordre renvoyé par le serveur. */}
          {palier.obstacles.map((obstacle, index) => (
            <Texte
              key={`${obstacle.raison}-${index}`}
              variante="type.caption"
              couleur="text.secondary"
              testID={`obstacle-${obstacle.raison}`}
            >
              {messageDObstacle(t, obstacle, CODES_CONNUS, palier.platform)}
            </Texte>
          ))}
        </>
      ) : null}
    </View>
  );
}
