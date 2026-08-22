/**
 * L'annuaire des créateurs, côté commerce abonné.
 *
 * **C'est ce que BIND vend.** Un salon paie pour l'accès à un réseau ; sans cet
 * écran, il ne voit que ce qui est déjà réservable autour de lui, et
 * l'abonnement n'a rien à montrer avant la première collaboration.
 *
 * **Aucun score de fiabilité, et l'écran n'en parle pas — c'est un
 * renversement.** Cet écran portait une ligne qui expliquait l'absence de note :
 * « nous ne vous montrons jamais de note, et nous ne classons jamais les
 * créatrices entre elles ». L'intention était bonne et l'effet inverse.
 * **Écrire qu'on ne montre pas la note apprend qu'une note existe**, et installe
 * un salon à la chercher ailleurs — chez la créatrice, ou en la demandant. La
 * ligne est retirée, et l'absence de mention est délibérée.
 *
 * Ce qui rend le silence tenable : le palier accessible **est** le signal. Un
 * score dégradé plafonne mécaniquement, donc une créatrice ouverte au palier
 * reel tient ses engagements — l'information passe sans être nommée, et sans
 * qu'un nombre permette de classer.
 *
 * **L'absence de contact, elle, s'explique**, et c'est l'exact inverse du cas
 * précédent. Un salon **cherchera** ce bouton, parce que tous les annuaires
 * qu'il connaît en ont un ; ne rien dire le laisse conclure au défaut. Une
 * absence qu'on ne cherche pas se tait, une absence qu'on cherche se dit.
 *
 * **Lecture seule.** On atteint une créatrice en ouvrant une prestation à son
 * palier — c'est le mécanisme du produit, et un raccourci ici en créerait un
 * second, hors du système de paliers.
 */
import { Image, Linking, Pressable, View } from 'react-native';

import {
  useApi,
  type AnnuaireDuCommerce,
  type CreateurDeLAnnuaire,
  type PorteeLocale,
} from '../api';
import {
  Apparition,
  Button,
  EmptyState,
  Filet,
  Icone,
  SkeletonLignes,
  StatusMessage,
  Texte,
  TierBadge,
} from '../components';
import { formatNumber } from '../format';
import { useI18n } from '../i18n';
import { useGabarit } from '../shell/gabarit';
import { elevationDeCarte, radius, useColors } from '../theme';
import { Ecran } from './Ecran';
import { nomDePlateforme } from './obstacle';
import { useRequete } from './useRequete';

/** Le code que le serveur rend à un commerce sans abonnement vivant. */
const SANS_ABONNEMENT = 'subscription_required';

/**
 * L'instant d'une réponse qui n'a rien à dater.
 *
 * Le refus d'abonnement ne vieillit pas : il ne dépend d'aucune lecture, et la
 * mention « vu il y a deux minutes » n'aurait pas d'objet. Zéro dit « pas de
 * fraîcheur à annoncer » plutôt qu'une date inventée.
 */
const DEJA_SU = 0;

export function AnnuaireScreen({
  businessId,
  onVoirLAbonnement,
}: {
  businessId: string;
  /**
   * Le chemin vers l'abonnement, depuis le mur qui le réclame.
   *
   * **Le refus menait nulle part.** L'écran interceptait bien le 402 et
   * expliquait qu'un abonnement manque — puis s'arrêtait là. C'est ce que BIND
   * vend, et le seul endroit où un commerce le rencontre.
   *
   * Optionnel : absent, la phrase reste et le bouton disparaît. Un bouton qui
   * ne mène nulle part vaut moins que pas de bouton.
   */
  onVoirLAbonnement?: () => void;
}) {
  const { api } = useApi();
  const { t } = useI18n();
  // Lu ici et non dans le corps de rendu d'`Ecran` : ce corps est une fonction
  // appelée pendant le rendu d'un **autre** composant, et un hook y serait
  // appelé hors de son propre composant.
  const c = useColors();

  const requete = useRequete<AnnuaireDuCommerce>(
    (signal) => api.annuaireDesCreateurs(businessId, signal),
    { estVide: (annuaire) => annuaire.createurs.length === 0, dependances: [businessId] },
  );

  // **Le refus d'abonnement n'est pas une panne.** L'écran d'erreur générique
  // proposerait « réessayer », ce qui ne mène nulle part : il n'y a rien à
  // réessayer, il y a un abonnement à prendre. On l'intercepte donc avant.
  const sansAbonnement =
    requete.etat === 'erreur' &&
    typeof requete.erreur === 'object' &&
    requete.erreur !== null &&
    'code' in requete.erreur &&
    (requete.erreur as { code?: string }).code === SANS_ABONNEMENT;

  if (sansAbonnement) {
    // Une réponse **prête**, dont le contenu est l'explication. Réutiliser
    // l'état d'erreur donnerait « réessayer », qui ne mène nulle part : il n'y
    // a rien à réessayer, il y a un abonnement à prendre.
    return (
      <Ecran
        requete={{
          etat: 'pret',
          donnees: { portee: PORTEE_INCONNUE, createurs: [] },
          vide: false,
          rechargement: false,
          vuA: DEJA_SU,
          recharger: requete.recharger,
        }}
        titre={t('annuaire.titre')}
        nature="creator"
        testID="ecran-annuaire"
      >
        {() => (
          <View style={{ gap: 12 }}>
            <StatusMessage
              level="neutral"
              title={t('annuaire.abonnementRequis')}
              body={t('annuaire.abonnementRequisAide')}
              testID="annuaire-sans-abonnement"
            />
            {onVoirLAbonnement ? (
              <View style={{ alignSelf: 'flex-start' }}>
                <Button
                  label={t('annuaire.voirLesPlans')}
                  onPress={onVoirLAbonnement}
                  testID="voir-les-plans"
                />
              </View>
            ) : null}
          </View>
        )}
      </Ecran>
    );
  }

  return (
    <Ecran
      requete={requete}
      titre={t('annuaire.titre')}
      nature="creator"
      squelette={<SkeletonLignes combien={6} testID="squelette-annuaire" />}
      testID="ecran-annuaire"
      vide={
        <EmptyState
          title={t('annuaire.videTitre')}
          body={t('annuaire.vide')}
          testID="annuaire-vide"
        />
      }
    >
      {(annuaire) => (
        <View style={{ gap: 16 }}>
          {/* **Le compte, avant la liste.** C'est le renversement de la v3 : à
              deux mille créatrices un salon ne cherche pas, il ne connaît aucun
              nom. Le chiffre est ce qu'il répétera à son associé, et le seul qui
              justifie l'abonnement à lui seul. */}
          <Portee portee={annuaire.portee} />

          <Texte variante="type.body" couleur="ink.soft" testID="annuaire-sous-titre">
            {t('annuaire.sousTitre')}
          </Texte>

          {annuaire.createurs.map((createur, rang) => (
            <Apparition key={createur.creator_id} rang={rang}>
              <FicheDeCreateur createur={createur} />
            </Apparition>
          ))}
        </View>
      )}
    </Ecran>
  );
}

/**
 * Ce que le refus d'abonnement laisse comme portée : rien de chiffrable.
 *
 * Zéro partout **n'est pas un compte à zéro** — c'est l'absence de compte. La
 * carte ne se rend pas dans ce cas, et ces valeurs ne sont jamais lues ; elles
 * existent pour que la réponse simulée ait la forme d'une réponse.
 */
const PORTEE_INCONNUE: PorteeLocale = {
  createurs: 0,
  peuvent_reserver: 0,
  rayon_metres: 0,
  gains_par_palier: [],
};

/**
 * Le compte, et ce qu'un palier de plus ouvrirait.
 *
 * **C'est par là que l'écran commence, et c'est la décision de la v3.** Un champ
 * de recherche ne sert qu'à qui sait déjà quoi taper — c'est-à-dire à personne,
 * ici. Ce qu'un salon veut savoir tient en une question : combien de gens
 * peuvent réserver ce que j'ai ouvert, et est-ce que j'en aurais plus en
 * ouvrant davantage.
 *
 * **Le gain n'est pas un total, et c'est la faute à ne pas commettre.**
 * `createurs_en_plus` compte ce que l'ouverture *ajoute* : les populations se
 * recouvrent — une créatrice qui ouvre le reel ouvre le story — et additionner
 * des totaux par palier annoncerait un marché qui n'existe pas. La phrase se
 * compose donc `peuvent_reserver + createurs_en_plus`.
 *
 * **Jamais « 128 créatrices » tout court.** Celles qui n'ont pas renseigné de
 * position ne sont comptées nulle part : le nombre est celui des créatrices
 * dont on peut affirmer qu'elles sont dans le rayon. « Autour de vous » est
 * donc obligatoire dans la phrase, pas décoratif.
 */
function Portee({ portee }: { portee: PorteeLocale }) {
  const { t, locale } = useI18n();
  const c = useColors();

  // Rien autour : la carte se tait plutôt que d'afficher « 0 des 0 ». L'écran
  // a déjà son état vide, qui dit la même chose en mieux.
  if (portee.createurs === 0) return null;

  // Le meilleur candidat, un seul. La planche montre une phrase, pas une liste
  // de paliers à comparer — et un gain nul ne se propose pas.
  const meilleur = portee.gains_par_palier.reduce<PorteeLocale['gains_par_palier'][number] | null>(
    (garde, gain) =>
      gain.createurs_en_plus > 0 && (garde === null || gain.createurs_en_plus > garde.createurs_en_plus)
        ? gain
        : garde,
    null,
  );

  return (
    <View
      testID="portee-du-salon"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 18,
        padding: 18,
        borderRadius: radius['radius.lg'],
        backgroundColor: c['brand.100'],
      }}
    >
      <View style={{ gap: 2 }}>
        <Texte variante="type.figure" testID="peuvent-reserver">
          {formatNumber(portee.peuvent_reserver, locale)}
        </Texte>
        <Texte variante="type.caption" couleur="ink.soft">
          {t('annuaire.porteeSur', {
            total: formatNumber(portee.createurs, locale),
            km: String(Math.round(portee.rayon_metres / 1000)),
          })}
        </Texte>
      </View>

      <View style={{ flex: 1, gap: 4 }}>
        <Texte variante="type.body">{t('annuaire.porteePeuvent')}</Texte>
        {meilleur ? (
          <Texte variante="type.body" testID="gain-de-palier">
            {t('annuaire.porteeGain', {
              palier: t(`parcours.format_${meilleur.content_format}`),
              total: formatNumber(portee.peuvent_reserver + meilleur.createurs_en_plus, locale),
            })}
          </Texte>
        ) : null}
      </View>
    </View>
  );
}

function FicheDeCreateur({ createur }: { createur: CreateurDeLAnnuaire }) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const c = useColors();
  const { large } = useGabarit();

  // **Le pseudonyme, jamais le nom civil.** La planche v3 titre chaque fiche
  // `@lea.mrl` ; l'écran titrait « Léa Martel », c'est-à-dire l'identité d'état
  // civil de cent vingt-huit personnes affichée à un salon qui ne les connaît
  // pas. Le pseudonyme suffit à ce que l'annuaire sert : reconnaître un compte
  // et aller voir son travail. Le nom civil arrive à la réservation, quand une
  // créatrice a choisi ce salon — pas avant, et pas à tout le monde.
  //
  // La route ne les sert plus du tout : ils sont sortis du schéma, pas
  // seulement de l'écran. Un champ qu'on cesse d'afficher et qu'on continue
  // d'envoyer n'est pas retiré, il est caché.
  const nom = createur.comptes.find((compte) => compte.handle)?.handle ?? t('annuaire.sansNom');

  // La vignette du premier compte qui en a une. La liste n'a jamais eu besoin
  // de l'original, et le détail n'existe pas encore sur cet écran.
  // **Telle quelle, jamais suffixée.** `urlDeLaVignette` ajoute `@vignette` ;
  // sans abonnement la clé est déjà celle d'un aperçu — suffixe `@apercu` — et
  // la suffixer une seconde fois ne rendrait rien. Le cadre serait vide et on
  // l'aurait pris pour le 404 prévu, ce qui est la façon la plus sûre de ne
  // jamais trouver le défaut.
  const portrait = api.urlDuMedia(
    createur.comptes.find((compte) => compte.avatar_key)?.avatar_key ?? null,
  );

  return (
    <View
      testID={`createur-${createur.creator_id}`}
      style={{
        gap: 12,
        padding: 16,
        borderRadius: radius['radius.lg'],
        borderWidth: 1,
        borderColor: c['line.default'],
        backgroundColor: c['bg.surface'],
        flexDirection: large ? 'row' : 'column',
        alignItems: large ? 'center' : undefined,
        // « Un coin de 18 px sans ombre flotte au lieu de se poser » : passation §2.
        ...elevationDeCarte(),
      }}
    >
      {/* **La photo, et le cadre qui reste quand elle manque.** `avatar_key`
          était servi par le serveur et jeté par le type de l'app : l'annuaire
          rendait des fiches sans visage alors que la donnée arrivait. Le cadre
          vide n'est pas un cas limite — la même clé sert l'aperçu flouté au
          salon sans abonnement, et les photos déposées avant cet aperçu
          répondront 404 plutôt que de retomber sur l'original. */}
      <View
        testID={`portrait-${createur.creator_id}`}
        style={{
          width: 56,
          height: 56,
          borderRadius: radius['radius.photo'],
          backgroundColor: c['bg.sunken'],
          overflow: 'hidden',
        }}
      >
        {portrait ? (
          <Image
            source={{ uri: portrait }}
            style={{ width: 56, height: 56 }}
            resizeMode="cover"
            testID={`photo-${createur.creator_id}`}
          />
        ) : null}
      </View>

      <View style={{ flex: large ? 1 : undefined, gap: 2, minWidth: 0 }}>
        <Texte variante="type.bodyStrong">{nom}</Texte>
        {createur.city ? (
          <Texte variante="type.caption" couleur="ink.mute">
            {createur.city}
          </Texte>
        ) : null}
        {createur.bio ? (
          <Texte variante="type.caption" couleur="ink.soft">
            {createur.bio}
          </Texte>
        ) : null}
      </View>

      {large ? <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: c['line.default'] }} /> : <Filet />}

      <View style={{ width: large ? 260 : undefined, gap: 4 }}>
        {/* L'audience, en volume cumulé. Un ordre de grandeur, jamais une
            portée atteinte : la même précaution que sur les rapports. */}
        <Texte variante="type.figureSmall" testID={`audience-${createur.creator_id}`}>
          {formatNumber(createur.audience_totale, locale)}
        </Texte>
        {/* **Le cumul se légende par le nombre de réseaux, pas par le volume.**
            La légende répétait « 24 000 followers » juste sous le chiffre, et
            les lignes de réseau le redisaient une troisième fois. Ce que le
            chiffre ne dit pas tout seul, c'est de combien de comptes il vient. */}
        <Texte variante="type.caption" couleur="ink.soft">
          {createur.comptes.length === 1
            ? t('annuaire.audienceUnReseau')
            : t('annuaire.audience', { reseaux: createur.comptes.length })}
        </Texte>
        {/* **Le pseudonyme mène au profil public, et c'est le seul geste que
            l'annuaire propose.** Le lien sort du produit : on va voir son
            travail chez elle. `profil_url` était servi et jeté par le type de
            l'app, si bien que l'écran rendait des pseudonymes morts. */}
        {createur.comptes.map((compte) => {
          // Le réseau et son volume, jamais le pseudonyme — il titre déjà la
          // fiche, et le répéter ici faisait lire deux fois la même chose. La
          // formulation est celle de la journée : une seule grammaire pour la
          // ligne de réseau côté commerce.
          const ligne = (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Texte variante="type.caption" couleur={compte.profil_url ? 'brand.700' : 'ink.mute'}>
                {compte.followers === null
                  ? nomDePlateforme(compte.platform)
                  : t('commerce.reseauAvecAbonnes', {
                      reseau: nomDePlateforme(compte.platform),
                      abonnes: formatNumber(compte.followers, locale),
                    })}
              </Texte>
              {compte.profil_url ? <Icone nom="sortie" taille={13} couleur="brand.700" /> : null}
            </View>
          );

          return compte.profil_url ? (
            <Pressable
              key={`${compte.platform}-${compte.handle}`}
              accessibilityRole="link"
              onPress={() => void Linking.openURL(compte.profil_url as string)}
              testID={`profil-${createur.creator_id}-${compte.platform}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              {ligne}
            </Pressable>
          ) : (
            <View key={`${compte.platform}-${compte.handle}`}>{ligne}</View>
          );
        })}

        {/* **L'absence de contact se dit, elle.** Un salon cherchera ce bouton
            — tous les annuaires qu'il connaît en ont un — et ne rien dire le
            laisse conclure au défaut. C'est l'inverse du score, qu'on tait
            justement parce que personne ne le cherche. */}
        <Texte
          variante="type.caption"
          couleur="ink.mute"
          testID={`pas-de-contact-${createur.creator_id}`}
        >
          {t('annuaire.pasDeContact')}
        </Texte>
      </View>

      <View style={{ width: large ? 220 : undefined, gap: 6 }}>
        <Texte variante="type.label" couleur="ink.soft">
          {t('annuaire.paliersOuverts')}
        </Texte>
        {createur.paliers_ouverts.length === 0 ? (
          // **Le champ a changé de sens, et la phrase suivait l'ancien.**
          // `paliers_ouverts` répondait « elle se qualifie quelque part » : une
          // liste vide ne pouvait alors venir que de son audience, et la phrase
          // le disait sans rien lui reprocher. Elle répond depuis la PR 213
          // (numéro écrit sans dièse : trois chiffres précédés d'un dièse font
          // un hexadécimal valide, que la garde des couleurs en dur refuse —
          // à raison, elle ne peut pas distinguer un renvoi d'une couleur)
          // « elle
          // peut réserver ce que **vous** avez ouvert », et le vide a deux
          // causes — son audience, ou des paliers que ce salon n'a pas ouverts.
          //
          // La phrase énonce donc ce qui est certain, du côté du salon, et
          // n'attribue plus rien. Le levier, lui, est déjà en tête d'écran :
          // « ouvrir le palier post porterait ce chiffre à 103 ».
          <Texte
            variante="type.caption"
            couleur="ink.mute"
            testID={`sans-palier-${createur.creator_id}`}
          >
            {t('annuaire.aucunPalier')}
          </Texte>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {createur.paliers_ouverts.map((format) => (
              <TierBadge key={format} tier={format} size="sm" />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
