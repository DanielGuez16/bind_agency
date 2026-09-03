/**
 * Où le salon se montre ailleurs.
 *
 * **Trois champs facultatifs et indépendants.** Un salon peut n'avoir
 * qu'Instagram, ou qu'un site, ou rien — et « rien » est un état normal, pas
 * une composition inachevée : aucun de ces liens n'entre dans les étapes qui
 * retiennent la publication.
 *
 * **Un seul enregistrement pour les trois.** Ils se saisissent ensemble et
 * partent ensemble : trois appels feraient trois écritures dont deux peuvent
 * échouer, et l'écran ne saurait plus lequel est enregistré.
 *
 * **Rien n'est deviné.** Le lien du profil d'une créatrice se calcule de son
 * pseudonyme et de sa plateforme ; celui d'un salon, non — la page d'une marque
 * n'est pas toujours un compte, et la fabriquer rendrait un lien mort que le
 * salon découvrirait par un créateur.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { useApi } from '../../api';
import { Button, StatusMessage, TextField } from '../../components';
import { useI18n } from '../../i18n';

/** Ce que l'écran édite : trois adresses, ou rien. */
export type LiensPublics = {
  instagram_url: string | null;
  tiktok_url: string | null;
  facebook_url: string | null;
  website_url: string | null;
};

/**
 * Ce qui part au serveur : la chaîne vide devient `null`.
 *
 * **Vider un champ le retire, et c'est le seul geste qui le retire.** Sans
 * cette conversion, un salon qui efface son lien enverrait `""` — une adresse
 * vide que la fiche rendrait comme un lien vers nulle part.
 */
export function aEnvoyer(saisi: LiensPublics): LiensPublics {
  const nettoyer = (valeur: string | null) => {
    const propre = (valeur ?? '').trim();
    return propre.length === 0 ? null : propre;
  };
  return {
    instagram_url: nettoyer(saisi.instagram_url),
    tiktok_url: nettoyer(saisi.tiktok_url),
    facebook_url: nettoyer(saisi.facebook_url),
    website_url: nettoyer(saisi.website_url),
  };
}

export function LesLiensPublics({
  businessId,
  liens,
  onChange,
}: {
  businessId: string;
  liens: LiensPublics;
  onChange: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const [saisi, setSaisi] = useState<LiensPublics>(liens);
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);

  const change =
    aEnvoyer(saisi).instagram_url !== liens.instagram_url ||
    aEnvoyer(saisi).tiktok_url !== liens.tiktok_url ||
    aEnvoyer(saisi).facebook_url !== liens.facebook_url ||
    aEnvoyer(saisi).website_url !== liens.website_url;

  async function enregistrer() {
    setEchec(null);
    setEnvoi(true);
    try {
      await api.definirLesLiensPublics(businessId, aEnvoyer(saisi));
      onChange();
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <View style={{ gap: 12 }} testID="les-liens-publics">
      <TextField
        label={t('lieu.lienInstagram')}
        value={saisi.instagram_url ?? ''}
        onChangeText={(v) => setSaisi((avant) => ({ ...avant, instagram_url: v }))}
        placeholder="https://instagram.com/…"
        testID="champ-instagram"
      />
      <TextField
        label={t('lieu.lienTiktok')}
        value={saisi.tiktok_url ?? ''}
        onChangeText={(v) => setSaisi((avant) => ({ ...avant, tiktok_url: v }))}
        placeholder="https://tiktok.com/@…"
        testID="champ-tiktok"
      />
      <TextField
        label={t('lieu.lienFacebook')}
        value={saisi.facebook_url ?? ''}
        onChangeText={(v) => setSaisi((avant) => ({ ...avant, facebook_url: v }))}
        placeholder="https://facebook.com/…"
        testID="champ-facebook"
      />
      <TextField
        label={t('lieu.lienSite')}
        value={saisi.website_url ?? ''}
        onChangeText={(v) => setSaisi((avant) => ({ ...avant, website_url: v }))}
        placeholder="https://…"
        testID="champ-site"
      />

      {echec ? <StatusMessage level="danger" body={echec} testID="echec-des-liens" /> : null}

      {/* Le bouton ne paraît qu'une fois quelque chose changé : un
          enregistrement toujours offert fait douter de ce qui est enregistré. */}
      {change ? (
        <View style={{ flexDirection: 'row' }}>
          <Button
            label={t('composition.enregistrer')}
            loading={envoi}
            fullWidth={false}
            onPress={() => void enregistrer()}
            testID="enregistrer-les-liens"
          />
        </View>
      ) : null}
    </View>
  );
}
