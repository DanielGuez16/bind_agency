/**
 * La fiche d'une créatrice, telle qu'un salon abonné la lit.
 *
 * **La destination qui manquait.** L'annuaire listait, et le seul geste d'une
 * rangée était d'en sortir : on ouvrait Instagram dans un onglet, et ce que
 * l'abonnement achète restait derrière. Un salon décidait donc ailleurs, sur
 * une page qui n'est pas la nôtre et qui ne dit rien de ce qu'il peut réserver.
 *
 * **Ce que la rangée retenait, la fiche le donne.** La liste sert à trier —
 * pseudonyme, ville, distance, deux lignes de bio — et la fiche sert à
 * décider : la bio entière, le volume de chaque réseau, le cumul, et la liste
 * complète des paliers ouverts. C'est l'arbitrage inverse de celui de la
 * rangée, et c'est le même : chaque écran porte ce que sa question demande.
 *
 * **Les abonnés reviennent, et ils reviennent ici.** Ils avaient été retirés de
 * la grille en v9 avec une raison écrite noir sur blanc — « l'audience
 * appartient à la fiche qu'on ouvre pour décider, pas à une liste qu'on
 * parcourt ». La fiche n'existait pas encore, si bien que le retrait valait
 * suppression : le champ était servi, lu par personne, et le commentaire qui le
 * justifiait promettait un écran qui n'était pas écrit. Il l'est.
 *
 * **Ni nom civil, ni score de fiabilité.** La fiche n'ouvre rien que la liste
 * retenait. Le nom arrive à la réservation, quand une créatrice a choisi ce
 * salon ; le score n'est montré à aucun commerce, jamais — c'est une promesse
 * écrite à la créatrice sur son propre écran, et le palier accessible porte
 * déjà l'information sans la divulguer.
 */
import { View } from 'react-native';

import { useApi, type CreateurDeLAnnuaire } from '../api';
import { Icone, LienExterne, Photo, SkeletonFiche, Texte, TierBadge } from '../components';
import { formatDistance, formatNumber } from '../format';
import { useI18n } from '../i18n';
import { radius, useColors } from '../theme';
import { Ecran } from './Ecran';
import { nomDePlateforme } from './obstacle';
import { useRequete } from './useRequete';

/** Le portrait de la fiche. Plus grand que celui de la rangée, et rond aussi. */
const PORTRAIT = 96;

export function CreatriceScreen({
  businessId,
  creatorId,
  onRetour,
}: {
  businessId: string;
  creatorId: string;
  onRetour: () => void;
}) {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const c = useColors();

  const requete = useRequete<CreateurDeLAnnuaire>(
    (signal) => api.creatriceDeLAnnuaire(businessId, creatorId, signal),
    {
      // **Une fiche n'est jamais vide.** Elle existe ou elle n'existe pas — le
      // serveur répond 404, et l'écran d'erreur le dit. Un état « vide »
      // laisserait croire à une fiche sans contenu, ce qui n'arrive pas.
      estVide: () => false,
      dependances: [creatorId],
    },
  );

  return (
    <Ecran
      requete={requete}
      testID="ecran-creatrice"
      onRetour={onRetour}
      squelette={<SkeletonFiche testID="squelette-creatrice" />}
    >
      {(createur) => {
        const nom =
          createur.comptes.find((compte) => compte.handle)?.handle ?? t('annuaire.sansNom');

        const portrait = api.urlDuPortrait(
          createur.comptes.find((compte) => compte.avatar_key)?.avatar_key ?? null,
        );

        // « Wynwood, 320 m » : la virgule et non le point médian, qui sépare
        // des champs — la ville et la distance forment une seule situation.
        const situation = [
          createur.city,
          createur.distance_metres === null
            ? null
            : formatDistance(createur.distance_metres, locale),
        ]
          .filter(Boolean)
          .join(', ');

        // **Le cumul ne s'écrit qu'au-delà d'un réseau.** « 48 213 abonnés au
        // total » sous une seule ligne qui dit déjà 48 213 est une répétition
        // qui se lit comme une seconde grandeur.
        const avecVolume = createur.comptes.filter((compte) => compte.followers !== null);

        return (
          <View style={{ gap: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <View
                testID="portrait-de-la-creatrice"
                style={{
                  width: PORTRAIT,
                  height: PORTRAIT,
                  borderRadius: radius['radius.pill'],
                  overflow: 'hidden',
                  backgroundColor: c['media.placeholder'],
                  borderWidth: createur.peut_reserver_ici ? 2 : 0,
                  borderColor: c['line.solo'],
                }}
              >
                <Photo uri={portrait} style={{ flex: 1 }} testID="photo-de-la-creatrice" />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Texte variante="type.heading" ellipseSurNomPropre testID="nom-de-la-creatrice">
                  {nom}
                </Texte>
                {situation ? (
                  <Texte variante="type.body" couleur="ink.soft" testID="situation">
                    {situation}
                  </Texte>
                ) : null}
              </View>
            </View>

            {/* **Ce qu'elle dit d'elle-même, en entier.** La rangée en montre
                deux lignes pour trier ; la fiche la donne entière, c'est ce
                qu'on vient y lire. */}
            {createur.bio ? (
              <Texte variante="type.body" testID="bio-de-la-creatrice">
                {createur.bio}
              </Texte>
            ) : null}

            {/* **Ce que le salon peut en faire, dit et non peint.** L'anneau du
                portrait porte l'état à l'œil ; seul, il ferait reposer une
                information sur la couleur. La phrase le dit en toutes lettres,
                et elle dit ce que *le salon* peut en faire — jamais le palier
                de la créatrice, qui est un fait de son compte et non de cette
                relation. */}
            <View style={{ gap: 8 }} testID="ce-qu-elle-ouvre-ici">
              <Texte variante="type.bodyStrong">
                {t(
                  createur.peut_reserver_ici
                    ? 'annuaire.paliersOuverts'
                    : 'annuaire.aucunPalier',
                )}
              </Texte>
              {createur.paliers_ouverts.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {createur.paliers_ouverts.map((format) => (
                    <TierBadge key={format} tier={format} />
                  ))}
                </View>
              ) : null}
            </View>

            <View style={{ gap: 12 }} testID="les-reseaux">
              <Texte variante="type.bodyStrong">{t('creatrice.reseaux')}</Texte>
              {createur.comptes.map((compte) => (
                /* **Le lien sortant a déménagé, et il est ici chez lui.** Sur
                   la rangée, il était le seul geste et il faisait sortir du
                   produit avant toute décision. Sur la fiche, il est un geste
                   parmi d'autres — on a déjà lu ce qu'on avait à lire.

                   Une vraie ancre, parce qu'on ouvre volontiers deux profils
                   dans deux onglets sans perdre la fiche. `url` nul sur une
                   plateforme qu'on ne sait pas rattacher : la ligne garde sa
                   forme et ne prétend rien ouvrir. */
                <LienExterne
                  key={`${compte.platform}-${compte.handle}`}
                  testID={`reseau-${compte.platform}`}
                  url={compte.profil_url}
                  accessibilityLabel={[
                    compte.handle ?? nomDePlateforme(compte.platform),
                    compte.followers === null
                      ? null
                      : t('creatrice.abonnes', {
                          count: formatNumber(compte.followers, locale),
                        }),
                    compte.profil_url
                      ? t('annuaire.voirLeProfil', {
                          reseau: nomDePlateforme(compte.platform),
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' — ')}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: c['line.default'],
                  }}
                >
                  <Icone
                    nom={compte.platform === 'tiktok' ? 'tiktok' : 'instagram'}
                    couleur="ink.default"
                    taille={22}
                  />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Texte variante="type.body" ellipseSurNomPropre>
                      {compte.handle ?? nomDePlateforme(compte.platform)}
                    </Texte>
                    {/* **Nul n'est pas zéro.** Aucun relevé n'a encore abouti
                        sur ce compte ; « 0 abonné » serait un chiffre, et il
                        serait faux. La ligne se tait. */}
                    {compte.followers === null ? null : (
                      <Texte
                        variante="type.caption"
                        couleur="ink.soft"
                        testID={`abonnes-${compte.platform}`}
                      >
                        {t('creatrice.abonnes', {
                          count: formatNumber(compte.followers, locale),
                        })}
                      </Texte>
                    )}
                  </View>
                  {compte.profil_url ? (
                    <Icone nom="sortie" couleur="ink.soft" taille={18} />
                  ) : null}
                </LienExterne>
              ))}
              {avecVolume.length > 1 ? (
                <Texte variante="type.caption" couleur="ink.mute" testID="audience-cumulee">
                  {t('creatrice.audienceTotale', {
                    count: formatNumber(createur.audience_totale, locale),
                    reseaux: formatNumber(avecVolume.length, locale),
                  })}
                </Texte>
              ) : null}
            </View>
          </View>
        );
      }}
    </Ecran>
  );
}
