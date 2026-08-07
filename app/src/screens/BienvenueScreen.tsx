/**
 * L'accueil d'une créatrice qui vient de s'inscrire.
 *
 * **Il comble un trou, pas un manque de décoration.** Après l'inscription, on
 * arrivait sur un fil vide et zéro palier, sans un mot : rien ne disait que
 * tout dépend d'un compte social rattaché, et l'écran ressemblait à un produit
 * cassé plutôt qu'à un produit qui attend une étape.
 *
 * **Trois phrases, dans l'ordre de ce qui arrive.** Rattacher un réseau, voir
 * les paliers s'ouvrir, réserver et publier. Ce n'est pas un tutoriel : c'est
 * la seule chose que quelqu'un doit comprendre avant de faire son premier
 * geste, et elle tient en un écran.
 *
 * **Le premier pas est un bouton, pas une invitation à explorer.** « Plus
 * tard » existe et ne se cache pas — forcer un rattachement à l'inscription
 * fait fermer l'application — mais il est second.
 *
 * **Aucune promesse chiffrée.** Ni nombre de salons, ni délai : ce sont des
 * chiffres que l'écran n'a pas, et les inventer se paierait au premier
 * démenti.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { useApi, type PlateformeConnectable } from '../api';
import {
  Apparition,
  Button,
  Icone,
  Logo,
  StatusMessage,
  Texte,
  vibration,
  type NomIcone,
} from '../components';
import { useI18n } from '../i18n';
import { translateErrorCode } from '../i18n/errors';
import { rattacherUnReseau } from '../shell/rattacherUnReseau';
import { useTheme } from '../theme';
import { nomDePlateforme } from './obstacle';

const ETAPES: { icone: NomIcone; titre: string; corps: string }[] = [
  { icone: 'etincelle', titre: 'bienvenue.etape1Titre', corps: 'bienvenue.etape1Corps' },
  { icone: 'paliers', titre: 'bienvenue.etape2Titre', corps: 'bienvenue.etape2Corps' },
  { icone: 'calendrier', titre: 'bienvenue.etape3Titre', corps: 'bienvenue.etape3Corps' },
];

/**
 * Les réseaux qu'on sait rattacher aujourd'hui.
 *
 * Snapchat existe dans les paliers et pas ici : l'accès partenaire n'existe
 * pas. L'afficher grisé ferait attendre quelque chose qui n'arrive pas.
 */
const RESEAUX: PlateformeConnectable[] = ['instagram', 'tiktok'];

export function BienvenueScreen({
  onPlusTard,
  onRattache,
}: {
  onPlusTard: () => void;
  /** Le compte est rattaché : la coquille enchaîne sur le produit. */
  onRattache?: () => void;
}) {
  const { t } = useI18n();
  const { color: c, density } = useTheme();
  const { api, messageDErreur } = useApi();

  const [ouverture, setOuverture] = useState<PlateformeConnectable | null>(null);
  const [echec, setEchec] = useState<string | null>(null);

  async function connecter(plateforme: PlateformeConnectable) {
    setOuverture(plateforme);
    setEchec(null);
    vibration.action();
    try {
      const resultat = await rattacherUnReseau(api, plateforme);

      if (resultat.issue === 'rattache') {
        vibration.reussite();
        (onRattache ?? onPlusTard)();
        return;
      }
      // Un abandon ne dit rien : fermer le navigateur est un geste volontaire,
      // et lui répondre par une erreur est agressif.
      if (resultat.issue === 'echec') {
        vibration.echec();
        setEchec(translateErrorCode(t, resultat.code));
      }
    } catch (erreur) {
      // L'ouverture elle-même a échoué : personne n'est encore parti, et un
      // écran muet passe pour un bouton mort.
      vibration.echec();
      setEchec(messageDErreur(erreur));
    } finally {
      setOuverture(null);
    }
  }

  return (
    <View
      testID="ecran-bienvenue"
      style={{
        flex: 1,
        backgroundColor: c['bg.canvas'],
        padding: density.screenPadding,
        gap: 20,
        justifyContent: 'center',
      }}
    >
      <Apparition>
        <View style={{ gap: 14 }}>
          <Logo taille={56} />
          <Texte variante="type.display">{t('bienvenue.titre')}</Texte>
          <Texte variante="type.body" couleur="text.secondary">
            {t('bienvenue.principe')}
          </Texte>
        </View>
      </Apparition>

      {ETAPES.map((etape, rang) => (
        <Apparition key={etape.titre} rang={rang + 1}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <Icone nom={etape.icone} couleur="accent.default" taille={22} />
            <View style={{ flex: 1, gap: 2 }}>
              <Texte variante="type.bodyStrong">{t(etape.titre)}</Texte>
              <Texte variante="type.caption" couleur="text.secondary">
                {t(etape.corps)}
              </Texte>
            </View>
          </View>
        </Apparition>
      ))}

      {echec ? <StatusMessage level="danger" body={echec} testID="echec-connexion" /> : null}

      <Apparition rang={ETAPES.length + 1}>
        <View style={{ gap: 8 }}>
          <Texte variante="type.label" couleur="text.secondary">
            {t('bienvenue.choisir')}
          </Texte>
          {RESEAUX.map((reseau) => (
            <Button
              key={reseau}
              label={
                ouverture === reseau
                  ? t('bienvenue.ouverture', { reseau: nomDePlateforme(reseau) })
                  : nomDePlateforme(reseau)
              }
              loading={ouverture === reseau}
              onPress={() => void connecter(reseau)}
              testID={`connecter-${reseau}`}
            />
          ))}
          <Button
            label={t('bienvenue.plusTard')}
            variant="secondary"
            onPress={onPlusTard}
            testID="plus-tard"
          />
        </View>
      </Apparition>
    </View>
  );
}
