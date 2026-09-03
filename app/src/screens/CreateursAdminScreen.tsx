/**
 * L'annuaire des créatrices, côté administration.
 *
 * **En lignes, comme celui du commerce, et pour la même raison.** Une grille de
 * portraits se regarde ; une liste se parcourt. L'administration cherche
 * quelqu'un — un pseudonyme entendu au téléphone, un compte dont on vient de
 * lire le dossier en arbitrage — et une ligne par personne est ce qui se
 * parcourt le plus vite.
 *
 * **Ni état civil, ni score, et ce n'est pas une commodité.** La règle qui les
 * tient hors de l'annuaire du commerce ne vient pas du rôle de celui qui
 * regarde : elle vient de ce qu'un classement de personnes par note produit.
 * L'administration a l'écran d'arbitrage pour juger, et il juge **un dossier**.
 *
 * **Aucune distance, aucun palier accessible.** Les deux existent sur l'annuaire
 * du commerce parce qu'ils se calculent depuis un salon. Un administrateur n'en
 * a pas : les rendre ici demanderait d'inventer un salon de référence, dont
 * chaque chiffre serait faux d'une manière invisible.
 */
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { useApi, type CreateurAdmin } from '../api';
import { Icone, Photo, SkeletonLignes, TextField, Texte } from '../components';
import { formatNumber } from '../format';
import { useI18n } from '../i18n';
import { radius, useColors } from '../theme';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';
import { motion } from '../theme';

export function CreateursAdminScreen() {
  const { api } = useApi();
  const { t, locale } = useI18n();
  const [recherche, setRecherche] = useState('');
  const [demande, setDemande] = useState('');

  // **La recherche part au serveur, pas dans la page rendue.** Un filtre local
  // ne verrait que les cent premiers, c'est-à-dire pas celui qu'on cherche
  // quand on ne le trouve pas.
  const differer = useCallback((valeur: string) => {
    setRecherche(valeur);
    const delai = setTimeout(() => setDemande(valeur), motion.etat);
    return () => clearTimeout(delai);
  }, []);

  const requete = useRequete<CreateurAdmin[]>(
    (signal) => api.createursAdmin(demande || null, signal),
    { estVide: (liste) => liste.length === 0, dependances: [demande] },
  );

  return (
    <Ecran
      requete={requete}
      titre={t('admin.createursTitre')}
      sousTitre={t('admin.createursSousTitre')}
      squelette={<SkeletonLignes combien={8} testID="squelette-createurs" />}
      testID="ecran-createurs-admin"
      vide={
        <View style={{ gap: 12 }}>
          <BarreDeRecherche valeur={recherche} onChange={differer} />
          <Texte variante="type.caption" couleur="ink.soft" testID="createurs-vide">
            {t(demande ? 'admin.createursVideRecherche' : 'admin.createursVide')}
          </Texte>
        </View>
      }
    >
      {(createurs) => (
        <View style={{ gap: 12 }}>
          <BarreDeRecherche valeur={recherche} onChange={differer} />

          <Texte variante="type.caption" couleur="ink.soft" testID="compte-createurs">
            {t('admin.createursCompte', { n: String(createurs.length) })}
          </Texte>

          <View>
            {createurs.map((createur) => (
              <LigneDeCreateur key={createur.creator_id} createur={createur} locale={locale} />
            ))}
          </View>
        </View>
      )}
    </Ecran>
  );
}

function BarreDeRecherche({
  valeur,
  onChange,
}: {
  valeur: string;
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <TextField
      label={t('admin.createursRecherche')}
      value={valeur}
      onChangeText={onChange}
      testID="recherche-createurs"
    />
  );
}

/** Une créatrice : sa photo, son pseudonyme, ses réseaux, son volume. */
function LigneDeCreateur({
  createur,
  locale,
}: {
  createur: CreateurAdmin;
  locale: 'en' | 'es';
}) {
  const { api } = useApi();
  const { t } = useI18n();
  const c = useColors();

  // Le compte le plus suivi nomme la personne : l'ordre de rattachement est un
  // accident de parcours, le volume est ce qu'on retient d'elle.
  const tete = [...createur.reseaux].sort(
    (a, b) => (b.followers ?? -1) - (a.followers ?? -1),
  )[0];
  const portrait = tete?.avatar_key ? api.urlDuPortrait(tete.avatar_key) : null;

  return (
    <View
      testID={`createur-${createur.creator_id}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 60,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: c['line.default'],
      }}
    >
      {portrait ? (
        <Photo
          uri={portrait}
          hauteur={40}
          style={{ width: 40, borderRadius: radius['radius.pill'] }}
          testID={`portrait-${createur.creator_id}`}
        />
      ) : (
        // Un rond vide plutôt qu'une initiale : un pseudonyme n'a pas
        // d'initiale qui veuille dire quelque chose.
        <View
          testID={`portrait-absent-${createur.creator_id}`}
          style={{
            width: 40,
            height: 40,
            borderRadius: radius['radius.pill'],
            backgroundColor: c['bg.inset'],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icone nom="personne" taille={18} couleur="ink.soft" />
        </View>
      )}

      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Texte variante="type.body" testID={`pseudonyme-${createur.creator_id}`}>
          {tete?.handle ?? t('admin.createursSansReseau')}
        </Texte>
        <Texte variante="type.caption" couleur="ink.soft">
          {[
            createur.city,
            createur.reseaux.length > 0
              ? t('admin.createursAbonnes', {
                  n: formatNumber(createur.audience_totale, locale),
                })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Texte>
      </View>
    </View>
  );
}
