/**
 * Où le salon se montre ailleurs, vu par une créatrice.
 *
 * **Ce n'est pas de la décoration : c'est ce qu'on regarde avant de
 * s'engager.** Une créatrice s'apprête à publier chez ce salon — voir à quoi
 * ressemble son compte lui dit si l'association lui convient, et c'est la seule
 * chose de la fiche qui le dise.
 *
 * **Rien quand rien n'est renseigné.** Trois lignes vides diraient « ce salon
 * n'est nulle part », ce qui est faux : elles diraient seulement qu'il ne l'a
 * pas écrit.
 */
import { Linking, Pressable, View } from 'react-native';

import { Icone, Texte, type NomIcone } from '../../components';
import { useI18n } from '../../i18n';

type Lien = { cle: string; url: string; icone: NomIcone; libelle: string };

export function LesLiensDuSalon({
  liens,
  testID = 'liens-du-salon',
}: {
  liens: {
    instagram_url: string | null;
    tiktok_url: string | null;
    facebook_url: string | null;
    website_url: string | null;
  };
  testID?: string;
}) {
  const { t } = useI18n();

  const lignes: Lien[] = [];
  if (liens.instagram_url) {
    lignes.push({
      cle: 'instagram',
      url: liens.instagram_url,
      icone: 'instagram',
      libelle: t('lieu.lienInstagram'),
    });
  }
  if (liens.tiktok_url) {
    lignes.push({
      cle: 'tiktok',
      url: liens.tiktok_url,
      icone: 'tiktok',
      libelle: t('lieu.lienTiktok'),
    });
  }
  if (liens.facebook_url) {
    // **`sortie` et non un glyphe Facebook, faute d'en avoir un.**
    // `primitives.json` n'en porte pas, et sa garde existe précisément pour
    // que les tracés ne soient pas retapés de mémoire — en inventer un ici
    // serait le défaut qu'elle attrape. Le mot « Facebook » à côté porte le
    // sens ; le jour où Design fournit le glyphe, seule cette ligne change.
    lignes.push({
      cle: 'facebook',
      url: liens.facebook_url,
      icone: 'sortie',
      libelle: t('lieu.lienFacebook'),
    });
  }
  if (liens.website_url) {
    // Pas d'icône propre à un site : `sortie` dit « cela quitte le produit »,
    // ce qui est exactement ce qui se passe et vaut mieux qu'un glyphe inventé.
    lignes.push({
      cle: 'site',
      url: liens.website_url,
      icone: 'sortie',
      libelle: t('lieu.lienSite'),
    });
  }

  if (lignes.length === 0) return null;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }} testID={testID}>
      {lignes.map((ligne) => (
        <Pressable
          key={ligne.cle}
          accessibilityRole="link"
          accessibilityLabel={ligne.libelle}
          onPress={() => void Linking.openURL(ligne.url)}
          testID={`${testID}-${ligne.cle}`}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Icone nom={ligne.icone} couleur="brand.700" taille={16} />
          <Texte variante="type.caption" couleur="brand.700">
            {ligne.libelle}
          </Texte>
        </Pressable>
      ))}
    </View>
  );
}
