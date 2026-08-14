/**
 * 04 · Fiche commerce.
 *
 * **Un palier fermé reste visible et dit pourquoi.** C'est la divergence
 * assumée avec le fil : le fil filtre parce qu'il propose, la fiche informe
 * parce qu'elle décrit. Mais une offre fermée doit être **visiblement** non
 * réservable — pas de bouton, un motif — sinon on recrée le fil qui montre des
 * choses indisponibles.
 *
 * **Le bouton est retiré, pas grisé.** Un bouton grisé demande de deviner ce
 * qui le débloque ; son absence, accompagnée de l'obstacle, ne demande rien.
 *
 * **Ce que le commerce attend est rappelé avant la réservation.** Mention et
 * tag de lieu sont les deux éléments contrôlés ; les découvrir sur l'écran de
 * preuve serait les découvrir trop tard.
 */
import { useState } from 'react';
import { Image, Linking, View } from 'react-native';

import { useApi, type FichePublique, type OffreDeLaFiche } from '../api';
import { Button, LigneDeContrepartie, ServiceRow, StatusMessage, Texte } from '../components';
import { formatDateTime } from '../format';
import { useI18n } from '../i18n';
import { urlImage } from './FilScreen';
import { en } from '../i18n/en';
import { radius, useTheme } from '../theme';
import { Ecran } from './Ecran';
import { messageDObstacle } from './obstacle';
import { useRequete } from './useRequete';

const CODES_CONNUS = new Set(Object.keys(en.errors));

export function FicheScreen({
  businessId,
  onReserver,
  onRetour,
}: {
  businessId: string;
  onReserver: (offre: OffreDeLaFiche, fiche: FichePublique) => void;
  /** Le retour de la pile. Sur le web il n'y a ni geste ni bouton système :
   * sans lui, on ne quitte l'écran qu'en changeant d'onglet. */
  onRetour?: () => void;
}) {
  const { api } = useApi();
  const { t, locale } = useI18n();

  const requete = useRequete<FichePublique>((signal) => api.fichePublique(businessId, signal), {
    estVide: (fiche) => fiche.offres.length === 0,
    dependances: [businessId],
  });

  return (
    <Ecran
      onRetour={onRetour} requete={requete} testID="ecran-fiche">
      {(fiche) => (
        <View style={{ gap: 12 }}>
          <Texte variante="type.screenTitle" ellipseSurNomPropre>
            {fiche.name}
          </Texte>
          {fiche.address ? (
            <Texte variante="type.caption" couleur="ink.soft">
              {fiche.address}
            </Texte>
          ) : null}

          {/* **La carte a son propre accès, avant les offres.** Elle se
              consulte, la galerie se fait défiler : les ranger ensemble ferait
              chercher un plat entre deux photos de salle. Et elle vient avant,
              parce qu'une offre qui laisse un choix ne se décide pas sans
              elle. */}
          <AccesALaCarte pages={fiche.menu_pages} lien={fiche.menu_url} />

          <Texte variante="type.bodyStrong">{t('parcours.ficheOffres')}</Texte>
          {fiche.offres.map((offre) => (
            <Offre
              key={offre.tier_offer_id}
              offre={offre}
              // Le fuseau du salon : un « prochain créneau » se lit là où il a
              // lieu, jamais dans le fuseau du téléphone.
              timezone={fiche.timezone}
              onReserver={() => onReserver(offre, fiche)}
            />
          ))}
        </View>
      )}
    </Ecran>
  );
}

/**
 * L'entrée vers la carte du commerce.
 *
 * **Rien du tout quand il n'y a rien** : un salon de beauté n'a pas de carte, et
 * un bouton vide serait un cul-de-sac de plus.
 *
 * **Le lien seul s'annonce comme tel.** Quand il n'y a pas de pages, ouvrir la
 * carte sort de l'application. Un lien qui s'ouvre sans prévenir, au milieu d'un
 * parcours de réservation, fait perdre le fil à qui revient — et sur un
 * téléphone, « revenir » n'est pas toujours un geste évident.
 */
function AccesALaCarte({ pages, lien }: { pages: string[]; lien: string | null }) {
  const { t } = useI18n();
  const { api } = useApi();
  const [ouverte, setOuverte] = useState(false);

  if (pages.length === 0 && !lien) return null;

  return (
    <View style={{ gap: 8 }} testID="acces-a-la-carte">
      {pages.length > 0 ? (
        <>
          <Button
            label={t(ouverte ? 'parcours.ficheCarteFermer' : 'parcours.ficheCarteVoir')}
            variant="secondary"
            size="sm"
            onPress={() => setOuverte((avant) => !avant)}
            testID="voir-la-carte"
          />
          {/* Dépliée sur place plutôt qu'ouverte dans un écran à part : on
              consulte une carte en gardant l'offre sous les yeux, et une pile
              de plus ferait revenir en arrière pour comparer. */}
          {ouverte
            ? pages.map((cle, rang) => (
                <Image
                  key={cle}
                  testID={`page-de-carte-${rang}`}
                  // L'original : une carte se lit, et une vignette de 480 points
                  // ne se lit pas.
                  source={{ uri: api.urlDuMedia(cle) ?? undefined }}
                  style={{ width: '100%', aspectRatio: 3 / 4 }}
                  resizeMode="contain"
                />
              ))
            : null}
        </>
      ) : null}

      {lien ? (
        <>
          <Button
            label={t('parcours.ficheCarteEnLigne')}
            variant="ghost"
            size="sm"
            onPress={() => void Linking.openURL(lien)}
            testID="ouvrir-la-carte-en-ligne"
          />
          {/* Dit seulement quand c'est la seule forme : avec des pages
              au-dessus, le créateur a déjà lu la carte sans sortir. */}
          {pages.length === 0 ? (
            <Texte variante="type.caption" couleur="ink.mute" testID="carte-hors-application">
              {t('parcours.ficheCarteHorsApp')}
            </Texte>
          ) : null}
        </>
      ) : null}
    </View>
  );
}


function Offre({
  offre,
  timezone,
  onReserver,
}: {
  offre: OffreDeLaFiche;
  timezone: string;
  onReserver: () => void;
}) {
  const { color: c } = useTheme();
  const { t, locale } = useI18n();
  const { api } = useApi();

  const attendu = [
    offre.required_mention ? t('parcours.ficheMention', { mention: offre.required_mention }) : null,
    offre.required_geotag ? t('parcours.ficheLieu') : null,
  ].filter(Boolean);

  return (
    <View
      testID={`offre-${offre.tier_offer_id}`}
      style={{
        borderRadius: radius['radius.none'],
        borderWidth: 1,
        borderColor: c['line.default'],
        overflow: 'hidden',
        // Une offre fermée est visiblement en retrait. Le mot et l'obstacle
        // disent le reste ; la couleur seule ne porte rien.
        opacity: offre.accessible ? 1 : 0.75,
      }}
    >
      <ServiceRow
        name={offre.name}
        meta={offre.duration_minutes === null ? '' : `${offre.duration_minutes} min`}
        tier={offre.content_format}
        // Une vignette dans une liste d'offres. Le détail, lui, garde
        // l'original.
        thumbnail={urlImage(api.urlDeLaVignette(offre.photo_key))}
      />
      <View style={{ padding: 12, gap: 6 }}>
        <LigneDeContrepartie tier={offre.content_format} />
        {attendu.length ? (
          <Texte variante="type.caption" couleur="ink.soft" testID="attendu">
            {t('parcours.ficheAttendu', { quoi: attendu.join(' · ') })}
          </Texte>
        ) : null}

        {offre.accessible ? (
          <>
            <Texte variante="type.mono" couleur="ink.soft" testID="prochain-creneau">
              {offre.prochains_creneaux.length
                ? t('parcours.ficheProchain', {
                    // Dans le fuseau du salon, mois en lettres, sans
                    // secondes : « Next: 11/08/2026 16:45:00 » était la forme
                    // brute de `toLocaleString`.
                    heure: formatDateTime(offre.prochains_creneaux[0], locale, timezone),
                  })
                : t('parcours.ficheComplet')}
            </Texte>
            {/* Retiré, pas grisé, quand il ne reste plus rien à prendre. */}
            {offre.prochains_creneaux.length || !offre.requires_booking ? (
              <Button label={t('parcours.reserver')} onPress={onReserver} />
            ) : null}
          </>
        ) : (
          <View style={{ gap: 4 }} testID="offre-fermee">
            <StatusMessage
              level="neutral"
              body={t('parcours.ficheFerme')}
            />
            {/* Les mêmes codes que sur l'écran des paliers. Deux vocabulaires
                pour un même refus feraient croire à deux causes. */}
            {offre.obstacles.map((obstacle, index) => (
              <Texte
                key={`${obstacle.raison}-${index}`}
                variante="type.caption"
                couleur="ink.soft"
                testID={`obstacle-${obstacle.raison}`}
              >
                {messageDObstacle(t, obstacle, CODES_CONNUS, offre.platform, locale)}
              </Texte>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
