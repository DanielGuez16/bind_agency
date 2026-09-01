/**
 * Relecture d'une carte importée.
 *
 * **Rien n'entre au catalogue tant que le commerce n'a pas validé.** L'écran
 * ne fait que proposer : chaque ligne est modifiable, écartable, et rien ne
 * part avant le bouton final. Une extraction qui créerait des items
 * directement peuplerait un catalogue de prix faux que personne ne relirait.
 *
 * **La durée est saisie ici, et l'écran dit pourquoi.** Une carte affiche des
 * prix, pas des temps de poste — et quand elle affiche une durée, c'est celle
 * annoncée au client, pas celle que le commerce bloque. Les deux diffèrent
 * souvent d'un quart d'heure de remise en état.
 *
 * **Le prix est lu et transmis, jamais montré ni saisi.** L'écran demandait un
 * « prix en centimes » — le seul montant du produit, sur le seul écran qui en
 * portait un, et dans l'unité la moins lisible qui soit. Le prix a quitté la
 * composition le 2026-08-24 : le créateur ne reçoit pas d'argent, et le prix
 * n'est qu'une donnée de reporting. Ce que l'extraction lit vaut mieux que le
 * zéro que la composition à la main enregistre ; ça ne fait pas de lui une
 * chose à relire.
 *
 * Les lignes de faible confiance sont signalées. Tout relire avec la même
 * attention revient à ne rien relire.
 */
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { useApi, type LigneExtraite } from '../api';
import { Button, StatusMessage, TextField, Texte, Toggle } from '../components';
import { useI18n } from '../i18n';
import { elevationDeCarte, radius, useColors } from '../theme';

/** En dessous, la ligne est signalée à la relecture. */
export const CONFIANCE_BASSE = 0.7;

export type { LigneExtraite };

type LigneRevue = {
  name: string;
  /** Lu sur la carte, transmis tel quel. Voir l'en-tête : il ne se relit pas. */
  price_cents: number;
  duration_minutes: string;
  requires_booking: boolean;
  retenue: boolean;
  confidence: number;
};

function depuis(ligne: LigneExtraite): LigneRevue {
  return {
    name: ligne.name,
    price_cents: ligne.price_cents,
    // Volontairement vide : l'extraction ne la fournit pas, et la préremplir
    // avec un chiffre plausible ferait valider une durée que personne n'a
    // choisie.
    duration_minutes: '',
    requires_booking: true,
    retenue: true,
    confidence: Number(ligne.confidence),
  };
}

export function MenuReviewScreen({
  businessId,
  importId,
  lignesExtraites,
  onRetour,
  onValide,
}: {
  businessId: string;
  importId: string;
  lignesExtraites: LigneExtraite[];
  onRetour?: () => void;
  onValide?: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const c = useColors();
  const [lignes, setLignes] = useState<LigneRevue[]>(() => lignesExtraites.map(depuis));
  const [etat, setEtat] = useState<
    | { state: 'saisie' }
    | { state: 'envoi' }
    | { state: 'fait'; count: number }
    | { state: 'refuse'; message: string }
  >({ state: 'saisie' });

  const modifier = useCallback((index: number, champ: Partial<LigneRevue>) => {
    setLignes((actuelles) =>
      actuelles.map((ligne, i) => (i === index ? { ...ligne, ...champ } : ligne)),
    );
  }, []);

  const valider = useCallback(async () => {
    setEtat({ state: 'envoi' });
    try {
      const resultat = await api.validerLaCarteRelue(
        businessId,
        importId,
        lignes.map((ligne) => ({
          name: ligne.name,
          price_cents: ligne.price_cents,
          duration_minutes: ligne.duration_minutes ? Number(ligne.duration_minutes) : null,
          requires_booking: ligne.requires_booking,
          retenue: ligne.retenue,
        })),
      );
      setEtat({ state: 'fait', count: resultat.items_crees });
      onValide?.();
    } catch (erreur) {
      setEtat({ state: 'refuse', message: messageDErreur(erreur) });
    }
  }, [api, businessId, importId, lignes, messageDErreur, onValide]);

  if (lignesExtraites.length === 0) {
    return (
      <View style={{ gap: 12 }} testID="ecran-revue-de-carte">
        <Texte variante="type.heading">{t('menuImport.title')}</Texte>
        <Texte couleur="ink.soft" testID="carte-illisible">
          {t('menuImport.empty')}
        </Texte>
        {onRetour ? (
          <Button
            label={t('menuImport.retour')}
            variant="secondary"
            onPress={onRetour}
            testID="quitter-la-relecture"
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ gap: 16 }} testID="ecran-revue-de-carte">
      <Texte variante="type.heading">{t('menuImport.title')}</Texte>
      <Texte variante="type.caption" couleur="ink.soft">
        {t('menuImport.intro')}
      </Texte>

      {lignes.map((ligne, index) => (
        <View
          key={`${ligne.name}-${index}`}
          testID={`ligne-lue-${index}`}
          style={{
            padding: 16,
            gap: 12,
            borderRadius: radius['radius.lg'],
            backgroundColor: c['bg.surface'],
            ...elevationDeCarte(),
          }}
        >
          {ligne.confidence < CONFIANCE_BASSE ? (
            <StatusMessage
              level="warning"
              body={t('menuImport.lowConfidence')}
              testID={`confiance-basse-${index}`}
            />
          ) : null}

          <TextField
            label={t('menuImport.nameLabel')}
            value={ligne.name}
            onChangeText={(valeur) => modifier(index, { name: valeur })}
            testID={`nom-lu-${index}`}
          />

          <View style={RANGEE}>
            <Texte style={{ flexShrink: 1 }}>{t('menuImport.bookable')}</Texte>
            <Toggle
              value={ligne.requires_booking}
              onChange={(valeur) => modifier(index, { requires_booking: valeur })}
              accessibilityLabel={t('menuImport.bookable')}
              testID={`reservable-${index}`}
            />
          </View>

          {ligne.requires_booking ? (
            <TextField
              label={t('menuImport.durationLabel')}
              value={ligne.duration_minutes}
              onChangeText={(valeur) => modifier(index, { duration_minutes: valeur })}
              keyboard="numeric"
              helpText={t('menuImport.durationHint')}
              testID={`duree-lue-${index}`}
            />
          ) : null}

          <View style={RANGEE}>
            <Texte style={{ flexShrink: 1 }}>
              {ligne.retenue ? t('menuImport.keep') : t('menuImport.drop')}
            </Texte>
            <Toggle
              value={ligne.retenue}
              onChange={(valeur) => modifier(index, { retenue: valeur })}
              accessibilityLabel={t('menuImport.keep')}
              testID={`garder-${index}`}
            />
          </View>
        </View>
      ))}

      {etat.state === 'refuse' ? (
        <StatusMessage level="danger" body={etat.message} testID="refus-de-la-carte" />
      ) : null}

      {etat.state === 'fait' ? (
        <Texte couleur="status.success.text" testID="carte-validee">
          {t('menuImport.validated', { count: String(etat.count) })}
        </Texte>
      ) : (
        <Button
          label={t('menuImport.validate')}
          onPress={valider}
          disabled={etat.state === 'envoi'}
          testID="valider-la-carte"
        />
      )}

      {onRetour ? (
        <Button
          label={t('menuImport.retour')}
          variant="secondary"
          onPress={onRetour}
          testID="quitter-la-relecture"
        />
      ) : null}
    </View>
  );
}

/** Un libellé et sa bascule, alignés sur les deux bords. */
const RANGEE = {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
} as const;
