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
 * ---
 *
 * ## Ce que la composition du lot 4 ajoute
 *
 * **Le blocage est en tête, et il nomme ses prestations.** Une phrase d'aide
 * qui dit « une prestation qui laisse un choix ne se publie pas » oblige à
 * aller vérifier lesquelles, sur un autre écran, puis à revenir. Le bandeau
 * dit combien, lesquelles, et ce qui les ouvre — trois choses, au-dessus de
 * ce qui les débloque.
 *
 * Il n'apparaît **que s'il bloque quelque chose** : sur un salon de beauté qui
 * n'a aucune prestation à choix, un avertissement permanent sur la carte serait
 * du bruit sur un écran qu'il n'a aucune raison d'ouvrir.
 *
 * **« L'un ou l'autre suffit » vit sur le filet qui sépare les deux colonnes.**
 * C'est le seul endroit où la phrase ne peut pas être lue comme appartenant à
 * l'une des deux — écrite sous les pages, elle dirait « les pages suffisent » ;
 * sous le lien, l'inverse. Sans elle, un commerce qui a déjà un lien croit
 * devoir aussi photographier huit pages, et abandonne.
 */
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';

import { useApi, type PageDeLaCarte } from '../api';
import { Button, Icone, StatusMessage, TextField, Texte, vibration } from '../components';
import { useI18n } from '../i18n';
import { radius, useColors } from '../theme';

/** Huit pages au plus. La borne est du serveur ; l'écran la dit avant de la subir. */
const PAGES_AU_MAXIMUM = 8;

export function CarteDuCommerce({
  businessId,
  pages,
  lien,
  bloquees = [],
  onChange,
}: {
  businessId: string;
  pages: PageDeLaCarte[];
  /** L'adresse enregistrée, ou `null`. Le champ part d'elle. */
  lien: string | null;
  /**
   * Les prestations qui laissent un choix, et que l'absence de carte retient.
   *
   * Passées plutôt que relues ici : le catalogue les a déjà, et les redemander
   * ferait un second appel pour une donnée qu'on tient.
   */
  bloquees?: { id: string; name: string }[];
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

  // Le blocage tombe dès qu'une des deux formes existe : c'est exactement la
  // règle du serveur, et l'écran ne doit pas en inventer une plus sévère.
  const carteDeposee = pages.length > 0 || Boolean(lien);
  const retenues = carteDeposee ? [] : bloquees;

  return (
    <View style={{ gap: 10 }} testID="carte-du-commerce">
      <Texte variante="type.label" couleur="ink.soft">
        {t('composition.carteTitre')}
      </Texte>
      {/* La distinction avec la galerie. Une phrase : c'est tout ce que cet
          écran a à expliquer une fois que le blocage se dit lui-même. */}
      <Texte variante="type.caption" couleur="ink.mute">
        {t('composition.carteAide')}
      </Texte>

      {/* **Le blocage nomme ses prestations, au-dessus de ce qui les ouvre.**
          Pas un point d'exclamation à côté d'un onglet : un compte, une raison,
          une issue, et la liste de ce qui attend. */}
      {retenues.length > 0 ? (
        <View
          testID="carte-blocage"
          style={{
            backgroundColor: c['status.warning.surface'],
            borderLeftWidth: 3,
            borderLeftColor: c['status.warning.rule'],
            padding: 14,
            flexDirection: 'row',
            gap: 12,
          }}
        >
          <Icone nom="alerte" couleur="status.warning.rule" taille={20} />
          <View style={{ flex: 1, gap: 3 }}>
            <Texte variante="type.bodyStrong">
              {retenues.length === 1
                ? t('composition.carteBloqueUne')
                : t('composition.carteBloqueTitre', { count: retenues.length })}
            </Texte>
            <Texte variante="type.caption" couleur="ink.soft">
              {t('composition.carteBloqueCorps')}
            </Texte>
            {/* Nommées, et toutes : « 2 prestations » sans lesquelles oblige à
                les chercher, et c'est le geste qu'on ne fait pas. */}
            {retenues.map((prestation) => (
              <Texte
                key={prestation.id}
                variante="type.caption"
                testID={`bloquee-${prestation.id}`}
              >
                {prestation.name}
              </Texte>
            ))}
          </View>
        </View>
      ) : null}

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
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
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
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
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
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
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
        // Le compte se dit avant que le refus arrive : « 3 / 8 » sur le bouton
        // vaut mieux qu'un « limite atteinte » à la neuvième photo choisie.
        size="sm"
        disabled={envoi || pages.length >= PAGES_AU_MAXIMUM}
        onPress={() => void choisirEtEnvoyer()}
        testID="ajouter-une-page"
      />
      <Texte variante="type.monoSmall" couleur="ink.mute" testID="compte-des-pages">
        {`${pages.length} / ${PAGES_AU_MAXIMUM}`}
      </Texte>

      {/* **La phrase vit entre les deux formes, jamais sous l'une d'elles.**
          C'est le seul endroit où elle ne peut pas être lue comme appartenant à
          la colonne qui la porte. */}
      <View
        testID="l-un-ou-l-autre"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 }}
      >
        <View style={{ flex: 1, height: 1, backgroundColor: c['line.strong'] }} />
        <Texte variante="type.monoSmall" couleur="ink.default">
          {t('composition.carteLUnOuLAutre')}
        </Texte>
        <View style={{ flex: 1, height: 1, backgroundColor: c['line.strong'] }} />
      </View>

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
