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
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Image, Linking, Modal, Pressable, View } from 'react-native';

import { useApi, type FichePublique, type OffreDeLaFiche } from '../api';
import {
  Button,
  Icone,
  LigneDeContrepartie,
  ServiceRow,
  StatusMessage,
  Texte,
  type NomIcone,
} from '../components';
import { formatDateTime, formatNumber } from '../format';
import { useI18n } from '../i18n';
import { urlImage } from './FilScreen';
import { en } from '../i18n/en';
import { elevationFlottante, radius, useTheme } from '../theme';
import { Ecran } from './Ecran';
import { messageDObstacle } from './obstacle';
import { useRequete } from './useRequete';
import { VisionneuseDeCarte, VisionneuseDeGalerie } from './Visionneuses';

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

  /**
   * Ce qui est ouvert par-dessus la fiche.
   *
   * **Une seule valeur pour trois états**, et non trois booléens : deux
   * visionneuses ouvertes en même temps est un état qui n'existe pas, et le
   * rendre représentable serait s'engager à le gérer.
   */
  const [ouvert, setOuvert] = useState<'galerie' | 'carte' | 'sortie' | null>(null);

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
          <AccesALaCarte
            fiche={fiche}
            onOuvrirLaGalerie={() => setOuvert('galerie')}
            onOuvrirLaCarte={() => setOuvert('carte')}
            onSortirVersLeLien={() => setOuvert('sortie')}
          />

          {/* **Les deux visionneuses sont plein écran, par-dessus la fiche.**
              Dépliées dans le flux, elles auraient rendu la fiche interminable
              et forcé à faire défiler une carte au milieu d'une liste d'offres.
              Une carte se lit en s'arrêtant : il lui faut l'écran. */}
          <Modal
            visible={ouvert === 'galerie'}
            animationType="fade"
            onRequestClose={() => setOuvert(null)}
          >
            <VisionneuseDeGalerie photos={fiche.photos} onFermer={() => setOuvert(null)} />
          </Modal>

          <Modal
            visible={ouvert === 'carte'}
            animationType="fade"
            onRequestClose={() => setOuvert(null)}
          >
            <VisionneuseDeCarte
              pages={fiche.menu_pages}
              onFermer={() => setOuvert(null)}
              // Réserver depuis la carte n'existe que s'il y a quelque chose à
              // réserver : sur une fiche dont toutes les offres sont fermées,
              // un bouton mènerait à un refus.
              onReserver={
                premiereOffreOuverte(fiche)
                  ? () => {
                      setOuvert(null);
                      onReserver(premiereOffreOuverte(fiche)!, fiche);
                    }
                  : undefined
              }
            />
          </Modal>

          <Modal
            visible={ouvert === 'sortie'}
            animationType="fade"
            transparent
            onRequestClose={() => setOuvert(null)}
          >
            <Voile onFermer={() => setOuvert(null)}>
              <FeuilleDeSortie
                nom={fiche.name}
                lien={fiche.menu_url ?? ''}
                onOuvrir={() => {
                  setOuvert(null);
                  if (fiche.menu_url) void Linking.openURL(fiche.menu_url);
                }}
                onRester={() => setOuvert(null)}
              />
            </Voile>
          </Modal>

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
 * 24a · Les deux accès de la fiche, et ils ne se mêlent jamais.
 *
 * **Une carte se lit, une galerie se regarde.** Ce sont deux gestes, pas deux
 * façons de voir la même chose : ranger les pages de la carte dans le
 * carrousel des photos ferait chercher une entrecôte entre deux vues de salle,
 * et ferait passer une page de menu pour une photo du lieu.
 *
 * **Deux lignes de la même carte, avec le même chevron.** Ni l'une ni l'autre
 * n'est un onglet caché ou une option de second rang : elles ont la même
 * hauteur, la même structure et la même affordance, et seuls leur glyphe et
 * leur libellé les distinguent.
 *
 * **La ligne de la carte est en teinte**, parce qu'elle est ce que la
 * créatrice vient chercher quand une prestation lui laisse un choix. C'est la
 * seule teinte de l'écran, et elle désigne — elle ne promeut pas.
 *
 * **Rien du tout quand il n'y a rien.** Un salon de beauté n'a pas de carte, et
 * une ligne vide serait un cul-de-sac de plus.
 *
 * **Le lien seul porte le glyphe de sortie, pas le chevron** : la différence se
 * voit avant l'appui, pas après.
 */
function AccesALaCarte({
  fiche,
  onOuvrirLaGalerie,
  onOuvrirLaCarte,
  onSortirVersLeLien,
}: {
  fiche: FichePublique;
  onOuvrirLaGalerie: () => void;
  onOuvrirLaCarte: () => void;
  onSortirVersLeLien: () => void;
}) {
  const { t, locale } = useI18n();
  const { color: c } = useTheme();

  const aDesPages = fiche.menu_pages.length > 0;
  const aUnLien = Boolean(fiche.menu_url);
  const aUneCarte = aDesPages || aUnLien;
  const aDesPhotos = fiche.photos.length > 0;

  if (!aUneCarte && !aDesPhotos) return null;

  return (
    <View
      testID="acces-a-la-carte"
      style={{
        borderWidth: 1,
        borderColor: c['line.default'],
        borderRadius: radius['radius.none'],
        backgroundColor: c['bg.surface'],
      }}
    >
      {aDesPhotos ? (
        <LigneDAcces
          glyphe="image"
          titre={t('parcours.fichePhotos')}
          detail={t('parcours.fichePhotosDetail', {
            count: formatNumber(fiche.photos.length, locale),
          })}
          onPress={onOuvrirLaGalerie}
          avecFilet={aUneCarte}
          testID="acces-galerie"
        />
      ) : null}

      {aUneCarte ? (
        <LigneDAcces
          glyphe="carte"
          teinte
          // Le glyphe de sortie **remplace** le chevron quand la carte n'existe
          // qu'ailleurs. Deux flèches différentes pour deux destinations
          // différentes, et la seconde se lit sans avoir été apprise.
          sortie={!aDesPages}
          titre={t('parcours.ficheCarte')}
          detail={
            aDesPages
              ? t('parcours.ficheCartePages', {
                  count: formatNumber(fiche.menu_pages.length, locale),
                })
              : t('parcours.ficheCarteSurLeurSite')
          }
          onPress={aDesPages ? onOuvrirLaCarte : onSortirVersLeLien}
          testID="acces-carte"
        />
      ) : null}
    </View>
  );
}

/** Une des deux lignes. Elles sont la même chose, et c'est le sujet. */
function LigneDAcces({
  glyphe,
  titre,
  detail,
  teinte = false,
  sortie = false,
  avecFilet = false,
  onPress,
  testID,
}: {
  glyphe: NomIcone;
  titre: string;
  detail: string;
  teinte?: boolean;
  sortie?: boolean;
  avecFilet?: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { color: c } = useTheme();
  const encre = teinte ? 'brand.700' : 'ink.default';

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${titre} · ${detail}`}
      onPress={onPress}
      style={{
        minHeight: 60,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 13,
        paddingHorizontal: 16,
        backgroundColor: teinte ? c['brand.50'] : 'transparent',
        borderBottomWidth: avecFilet ? 1 : 0,
        borderBottomColor: c['line.default'],
      }}
    >
      <Icone nom={glyphe} couleur={encre} taille={22} />
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Texte variante="type.bodyStrong" couleur={encre}>
          {titre}
        </Texte>
        <Texte variante="type.caption" couleur="ink.mute">
          {detail}
        </Texte>
      </View>
      <Icone nom={sortie ? 'sortie' : 'chevron'} couleur={teinte ? 'brand.700' : 'ink.mute'} taille={20} />
    </Pressable>
  );
}

/**
 * 24c · Ce qu'on dit avant de laisser partir.
 *
 * **Un lien qui s'ouvre sans prévenir, au milieu d'un parcours de réservation,
 * fait perdre le fil à qui revient** — et sur un téléphone, « revenir » n'est
 * pas toujours un geste évident.
 *
 * Trois choses, dans cet ordre : où l'on va, ce qu'on y trouvera, et surtout ce
 * qui ne se perd pas. La dernière est celle qui compte : ce n'est pas le départ
 * qui inquiète, c'est de croire qu'on perd la réservation en cours.
 *
 * **Le domaine s'écrit avant le départ**, en mono. Une adresse annoncée est une
 * adresse qu'on reconnaît en arrivant ; une adresse cachée derrière un verbe
 * fait arriver quelque part sans savoir où.
 */
function FeuilleDeSortie({
  nom,
  lien,
  onOuvrir,
  onRester,
}: {
  nom: string;
  lien: string;
  onOuvrir: () => void;
  onRester: () => void;
}) {
  const { t } = useI18n();
  const { color: c } = useTheme();

  return (
    <View testID="feuille-de-sortie" style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
        <Icone nom="sortie" couleur="ink.default" taille={24} />
        <Texte variante="type.heading" style={{ flex: 1 }}>
          {t('parcours.sortieTitre')}
        </Texte>
      </View>
      <Texte couleur="ink.soft">{t('parcours.sortieCorps', { nom })}</Texte>

      <View style={{ backgroundColor: c['bg.deep'], padding: 14 }}>
        <Texte variante="type.mono" ellipseSurNomPropre testID="domaine-de-sortie">
          {domaineDe(lien)}
        </Texte>
      </View>

      {/* Ce qui ne se perd pas. C'est la ligne qui décide, pas les deux
          au-dessus : personne n'hésite à lire une carte, on hésite à quitter
          une page qu'on a mis trois minutes à trouver. */}
      <Texte variante="type.caption" couleur="ink.mute">
        {t('parcours.sortieRassure')}
      </Texte>

      <View style={{ gap: 10 }}>
        <Button label={t('parcours.sortieOuvrir')} onPress={onOuvrir} testID="ouvrir-la-carte-en-ligne" />
        <Button
          label={t('parcours.sortieRester')}
          variant="secondary"
          onPress={onRester}
          testID="rester-ici"
        />
      </View>
    </View>
  );
}

/**
 * Le domaine seul, sans le protocole ni le chemin.
 *
 * **C'est le domaine qui dit où l'on va**, pas le chemin : `osteriarota.com` se
 * reconnaît, `https://osteriarota.com/fr/carte-du-soir?src=bind` se lit trois
 * fois et n'apprend rien de plus. Exportée pour être éprouvée seule — une
 * adresse mal découpée annoncerait un domaine qui n'est pas celui où l'on
 * arrive, et c'est le seul mensonge que cette feuille pourrait dire.
 */
export function domaineDe(lien: string): string {
  const sansProtocole = lien.replace(/^[a-z]+:\/\//i, '');
  const sansChemin = sansProtocole.split(/[/?#]/)[0];
  return sansChemin.replace(/^www\./i, '') || lien;
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
        {/* **La raison d'ouvrir la carte avant de réserver.** Sans cette ligne,
            « Menu du jour » se réserve comme une manucure : on croit savoir ce
            qu'on prend. En mono et sous le nom, là où l'œil descend après
            l'avoir lu — pas dans une note d'aide en bas de l'écran, qui arrive
            après la décision. */}
        {offre.leaves_choice ? (
          <Texte variante="type.monoSmall" couleur="ink.soft" testID="laisse-un-choix">
            {t('parcours.offreLaisseUnChoix')}
          </Texte>
        ) : null}
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

/**
 * La première offre réservable, s'il y en a une.
 *
 * Sert au bouton de la visionneuse : la lectrice a ouvert la carte pour
 * décider, et lui offrir de réserver ce qu'elle ne peut pas réserver serait
 * lui promettre un refus.
 */
function premiereOffreOuverte(fiche: FichePublique): OffreDeLaFiche | null {
  return fiche.offres.find((offre) => offre.accessible) ?? null;
}

/**
 * Le voile d'une feuille, et ce qu'il fait de l'appui à côté.
 *
 * Appuyer hors de la feuille la ferme : c'est le geste qu'on tente d'abord, et
 * ne pas l'écouter oblige à chercher un bouton pour annuler une action qu'on
 * n'a pas commencée.
 */
function Voile({ children, onFermer }: { children: ReactNode; onFermer: () => void }) {
  const { color: c } = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: c['scrim.modal'] }}>
      <Pressable
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onPress={onFermer}
        style={{ flex: 1 }}
        testID="voile-de-la-feuille"
      />
      <View
        style={{
          backgroundColor: c['bg.surface'],
          padding: 20,
          paddingBottom: 26,
          ...elevationFlottante(),
        }}
      >
        {children}
      </View>
    </View>
  );
}
