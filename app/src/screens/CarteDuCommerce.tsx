/**
 * La carte du commerce : ses pages, et le lien vers celle qui est déjà en ligne.
 *
 * **Ce n'est pas la galerie, et l'écran doit le dire.** La galerie montre le
 * lieu ; la carte se consulte. Un commerce qui les confondrait déposerait ses
 * photos de salle ici et sa carte là-bas, et un créateur chercherait une
 * entrecôte entre deux photos de vitrine. Le titre et l'aide portent la
 * distinction — c'est la seule chose que l'écran a à expliquer.
 *
 * **Deux formes, et l'une des deux suffit.** Des pages photographiées, ou une
 * adresse. Forcer à photographier une carte déjà bien présentée en ligne serait
 * absurde ; n'accepter que l'adresse priverait le salon qui n'a qu'un tableau au
 * mur. L'écran présente les deux côte à côte, sans en désigner une comme la
 * bonne.
 *
 * **Il dit à quoi ça sert, parce que rien d'autre ne le dira.** Une prestation
 * qui laisse un choix ne se publie pas tant qu'il n'y a ni pages ni lien. Le
 * refus arrive à l'ouverture de l'offre, sur un autre écran, plusieurs minutes
 * plus tard ; l'annoncer ici évite de le découvrir là-bas.
 *
 * **Le mécanisme est celui de la galerie**, jusqu'aux deux flèches : le glisser
 * n'existe pas en React Native sans bibliothèque tierce, et pour huit pages deux
 * flèches suffisent — elles marchent partout, se comprennent sans apprentissage,
 * et sont accessibles au lecteur d'écran.
 *
 * Design composera par-dessus. Ce qui compte ici est que chaque route soit
 * appelée par quelque chose : une route que personne n'appelle est le défaut
 * qu'on a réparé deux fois cette semaine.
 */
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';

import { useApi, type PageDeLaCarte } from '../api';
import { Button, Icone, StatusMessage, TextField, Texte, vibration } from '../components';
import { useI18n } from '../i18n';
import { radius, useColors } from '../theme';

export function CarteDuCommerce({
  businessId,
  pages,
  lien,
  onChange,
}: {
  businessId: string;
  pages: PageDeLaCarte[];
  /** L'adresse enregistrée, ou `null`. Le champ part d'elle. */
  lien: string | null;
  onChange: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const c = useColors();
  const [echec, setEchec] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [saisie, setSaisie] = useState(lien ?? '');

  async function agir(action: () => Promise<unknown>) {
    setEnvoi(true);
    setEchec(null);
    vibration.action();
    try {
      await action();
      onChange();
    } catch (erreur) {
      vibration.echec();
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  /**
   * Choisit une page et l'ajoute.
   *
   * Un refus de permission se dit comme un choix, pas comme une panne : la seule
   * issue est les réglages du téléphone, et réessayer ne redemandera rien.
   */
  async function choisirEtEnvoyer() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setEchec(t('composition.cartePermission'));
      return;
    }

    const resultat = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    const choisie = resultat.canceled ? null : resultat.assets[0];
    if (!choisie) return;

    await agir(() => api.ajouterUnePageDeCarte(businessId, choisie.uri));
  }

  /** Échange deux rangs et envoie l'ordre complet, que le serveur exige. */
  function deplacer(rang: number, vers: number) {
    const ordre = pages.map((page) => page.id);
    [ordre[rang], ordre[vers]] = [ordre[vers], ordre[rang]];
    return agir(() => api.ordonnerLaCarte(businessId, ordre));
  }

  /**
   * Enregistre l'adresse, ou la retire.
   *
   * **Une saisie vide envoie `null` et non une chaîne vide.** Le serveur ne
   * compte pas un lien fait d'espaces — c'est ce qui empêche d'ouvrir une offre
   * vers une carte que personne ne peut lire — et lui envoyer `""` laisserait
   * croire à un lien enregistré.
   */
  function enregistrerLeLien() {
    const propre = saisie.trim();
    return agir(() => api.definirLeLienDeLaCarte(businessId, propre === '' ? null : propre));
  }

  return (
    <View style={{ gap: 10 }} testID="carte-du-commerce">
      <Texte variante="type.label" couleur="ink.soft">
        {t('composition.carteTitre')}
      </Texte>
      {/* La distinction avec la galerie, et la règle qu'elle commande. Les deux
          en une phrase chacune : c'est tout ce que cet écran a à expliquer. */}
      <Texte variante="type.caption" couleur="ink.mute">
        {t('composition.carteAide')}
      </Texte>
      <Texte variante="type.caption" couleur="ink.mute" testID="carte-pourquoi">
        {t('composition.cartePourquoi')}
      </Texte>

      {echec ? <StatusMessage level="danger" body={echec} testID="echec-carte" /> : null}

      {pages.length === 0 ? (
        <Texte variante="type.caption" couleur="ink.mute" testID="carte-vide">
          {t('composition.carteVide')}
        </Texte>
      ) : null}

      {pages.map((page, rang) => (
        <View
          key={page.id}
          testID={`page-${page.id}`}
          accessibilityLabel={t('composition.carteRang', { rang: rang + 1, total: pages.length })}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            padding: 8,
            borderRadius: radius['radius.none'],
            borderWidth: 1,
            borderColor: c['line.default'],
            backgroundColor: c['bg.surface'],
          }}
        >
          <Image
            // La vignette : cette ligne vérifie un ordre, elle ne se lit pas.
            source={{ uri: api.urlDeLaVignette(page.storage_key) ?? undefined }}
            style={{ width: 56, height: 56, borderRadius: radius['radius.none'] }}
            resizeMode="cover"
          />

          <View style={{ flex: 1 }}>
            <Texte variante="type.caption" couleur="ink.mute">
              {t('composition.cartePage', { rang: rang + 1 })}
            </Texte>
          </View>

          {/* Une flèche absente plutôt que grisée : la première page ne peut pas
              monter, et un bouton gris invite à appuyer pour découvrir qu'il ne
              fait rien. */}
          {rang > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('composition.carteMonter')}
              disabled={envoi}
              hitSlop={8}
              onPress={() => void deplacer(rang, rang - 1)}
              testID={`monter-page-${page.id}`}
            >
              <Icone nom="monte" couleur="ink.soft" taille={20} />
            </Pressable>
          ) : null}
          {rang < pages.length - 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('composition.carteDescendre')}
              disabled={envoi}
              hitSlop={8}
              onPress={() => void deplacer(rang, rang + 1)}
              testID={`descendre-page-${page.id}`}
            >
              <Icone nom="descend" couleur="ink.soft" taille={20} />
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('composition.carteRetirer')}
            disabled={envoi}
            hitSlop={8}
            onPress={() => void agir(() => api.retirerUnePageDeCarte(businessId, page.id))}
            testID={`retirer-page-${page.id}`}
          >
            <Icone nom="croix" couleur="ink.soft" taille={20} />
          </Pressable>
        </View>
      ))}

      <Button
        label={t('composition.carteAjouter')}
        variant="secondary"
        size="sm"
        disabled={envoi}
        onPress={() => void choisirEtEnvoyer()}
        testID="ajouter-une-page"
      />

      {/* L'autre forme, présentée à égalité. L'une ou l'autre suffit. */}
      <TextField
        label={t('composition.carteLien')}
        helpText={t('composition.carteLienAide')}
        value={saisie}
        onChangeText={setSaisie}
        testID="champ-lien-de-la-carte"
      />
      <Button
        label={t('composition.carteLienEnregistrer')}
        variant="secondary"
        size="sm"
        disabled={envoi || saisie.trim() === (lien ?? '')}
        onPress={() => void enregistrerLeLien()}
        testID="enregistrer-le-lien"
      />
    </View>
  );
}
