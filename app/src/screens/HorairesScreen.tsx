/**
 * 10 · Horaires et capacité.
 *
 * **Un jour fermé s'affiche fermé.** Il ne disparaît pas de la liste : sept
 * lignes, toujours les sept, sinon le commerce lit un calendrier où l'absence
 * d'une ligne peut aussi bien vouloir dire « je n'ai pas encore rempli » que
 * « je suis fermé ». Les deux se corrigent différemment.
 *
 * **Horaires et capacité sont une seule règle.** Des horaires sans postes
 * n'ouvrent rien, des postes sans horaires n'ouvrent nulle part : la base les
 * porte ensemble, l'écran aussi.
 *
 * **La capacité est celle de BIND, pas celle du salon.** C'est le nombre de
 * créatrices acceptées en parallèle, indépendant de l'agenda client habituel.
 * Le dire évite qu'un commerce y recopie sa capacité totale et se retrouve
 * saturé de contreparties.
 *
 * **Une exception remplace la journée, elle ne s'y ajoute pas.** Fermer une
 * date retire les places restantes ; les réservations déjà prises sont
 * honorées. Un commerce ne peut jamais annuler une réservation d'un seul
 * geste — l'annulation individuelle passe par la ligne concernée, avec un
 * motif.
 */
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { useApi, type ExceptionDeCapacite, type RegleDeCapacite } from '../api';
import {
  Button,
  SkeletonLignes,
  StatusMessage,
  Stepper,
  Texte,
  TextField,
  vibration,
} from '../components';
import { useI18n } from '../i18n';
import { formatJour } from '../format';
import { Ecran } from './Ecran';
import { useRequete } from './useRequete';

/** Lundi en tête, comme la contrainte de base : 0 = lundi. */
const JOURS = [
  'composition.lundi',
  'composition.mardi',
  'composition.mercredi',
  'composition.jeudi',
  'composition.vendredi',
  'composition.samedi',
  'composition.dimanche',
] as const;

export type Semaine = { regles: RegleDeCapacite[]; exceptions: ExceptionDeCapacite[] };

export function HorairesScreen({
  businessId,
  onRetour,
}: {
  businessId: string;
  onRetour?: () => void;
}) {
  const { api } = useApi();
  const { t } = useI18n();

  const charger = useCallback(
    async (signal: AbortSignal): Promise<Semaine> => {
      const [regles, exceptions] = await Promise.all([
        api.reglesDeCapacite(businessId, signal),
        api.exceptionsDeCapacite(businessId, signal),
      ]);
      return { regles, exceptions };
    },
    [api, businessId],
  );

  // Jamais vide : sept jours existent toujours, même sans une seule règle. Un
  // état vide effacerait la liste au moment précis où elle sert à la remplir.
  const requete = useRequete<Semaine>(charger, {
    estVide: () => false,
    dependances: [businessId],
  });

  return (
    <Ecran
      requete={requete}
      titre={t('composition.horairesTitre')}
      onRetour={onRetour}
      // Rendu dans la colonne du menu de configuration, qui borne déjà.
      nature="section"
      squelette={<SkeletonLignes combien={7} testID="squelette-horaires" />}
      testID="ecran-horaires"
    >
      {(semaine) => (
        <HorairesDuCommerce
          semaine={semaine}
          businessId={businessId}
          onChange={requete.recharger}
        />
      )}
    </Ecran>
  );
}

/**
 * Une journée : ouverte avec ses horaires et ses postes, ou fermée.
 *
 * Fermée veut dire « aucune règle ce jour-là ». C'est la même chose en base, et
 * c'est ce que la disponibilité lit — il n'y a pas d'autre façon de le dire.
 */
function LigneDeJour({
  libelle,
  jour,
  regle,
  businessId,
  onChange,
}: {
  libelle: string;
  jour: number;
  regle: RegleDeCapacite | null;
  businessId: string;
  onChange: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const [ouvert, setOuvert] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const [debut, setDebut] = useState(regle?.start_time.slice(0, 5) ?? '10:00');
  const [fin, setFin] = useState(regle?.end_time.slice(0, 5) ?? '19:00');
  const [postes, setPostes] = useState(regle?.concurrent_slots ?? 1);

  async function agir(action: () => Promise<unknown>) {
    setEchec(null);
    setEnvoi(true);
    try {
      await action();
      vibration.action();
      setOuvert(false);
      onChange();
    } catch (erreur) {
      vibration.echec();
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  const enregistrer = () =>
    agir(() =>
      regle
        ? api.modifierUneRegle(businessId, regle.id, {
            start_time: `${debut}:00`,
            end_time: `${fin}:00`,
            concurrent_slots: postes,
          })
        : api.creerUneRegle(businessId, {
            weekday: jour,
            start_time: `${debut}:00`,
            end_time: `${fin}:00`,
            concurrent_slots: postes,
          }),
    );

  return (
    <View style={{ gap: 6 }} testID={`jour-${jour}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Texte variante="type.label">{libelle}</Texte>
        <View style={{ flex: 1 }}>
          {regle ? (
            <Texte variante="type.mono" couleur="ink.soft" testID={`horaires-${jour}`}>
              {regle.start_time.slice(0, 5)} – {regle.end_time.slice(0, 5)} ·{' '}
              {t('composition.postes', { n: regle.concurrent_slots })}
            </Texte>
          ) : (
            /* Écrit, jamais absent : une ligne manquante ne dit pas si le jour
               est fermé ou si le commerce n'a rien rempli. */
            <Texte variante="type.caption" couleur="ink.mute" testID={`ferme-${jour}`}>
              {t('composition.ferme')}
            </Texte>
          )}
        </View>
        <Button
          label={ouvert ? t('common.annuler') : t('composition.modifier')}
          variant="secondary"
          size="sm"
          onPress={() => setOuvert(!ouvert)}
          testID={`modifier-${jour}`}
        />
      </View>

      {ouvert ? (
        <View style={{ gap: 8, paddingLeft: 12 }} testID={`edition-${jour}`}>
          <TextField
            label={t('composition.champDebut')}
            value={debut}
            onChangeText={setDebut}
            testID={`debut-${jour}`}
          />
          <TextField
            label={t('composition.champFin')}
            value={fin}
            onChangeText={setFin}
            testID={`fin-${jour}`}
          />
          <Stepper
            label={t('composition.champPostes')}
            value={postes}
            min={1}
            max={20}
            onChange={setPostes}
            testID={`postes-${jour}`}
          />
          {echec ? <StatusMessage level="danger" body={echec} testID={`echec-${jour}`} /> : null}
          <Button
            label={t('composition.enregistrer')}
            loading={envoi}
            onPress={() => void enregistrer()}
            testID={`enregistrer-${jour}`}
          />
          {regle ? (
            <Button
              label={t('composition.fermerCeJour')}
              variant="secondary"
              onPress={() => void agir(() => api.supprimerUneRegle(businessId, regle.id))}
              testID={`fermer-${jour}`}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Exceptions({
  exceptions,
  businessId,
  onChange,
}: {
  exceptions: ExceptionDeCapacite[];
  businessId: string;
  onChange: () => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t, locale } = useI18n();
  const [date, setDate] = useState('');
  const [echec, setEchec] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function agir(action: () => Promise<unknown>) {
    setEchec(null);
    setEnvoi(true);
    try {
      await action();
      vibration.action();
      setDate('');
      onChange();
    } catch (erreur) {
      vibration.echec();
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <View style={{ gap: 8 }} testID="exceptions">
      <Texte variante="type.label">{t('composition.exceptions')}</Texte>

      {exceptions.length === 0 ? (
        <Texte variante="type.caption" couleur="ink.mute" testID="aucune-exception">
          {t('composition.aucuneException')}
        </Texte>
      ) : (
        exceptions.map((exception) => (
          <View
            key={exception.id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
            testID={`exception-${exception.id}`}
          >
            <Texte variante="type.mono" style={{ flex: 1 }}>
              {formatJour(exception.date, locale)} · {t('composition.ferme')}
            </Texte>
            <Button
              label={t('composition.retirer')}
              variant="secondary"
              size="sm"
              onPress={() =>
                void agir(() => api.supprimerUneException(businessId, exception.id))
              }
              testID={`retirer-${exception.id}`}
            />
          </View>
        ))
      )}

      <TextField
        label={t('composition.champDateDeFermeture')}
        helpText={t('composition.formatDeDate')}
        value={date}
        onChangeText={setDate}
        testID="champ-date-de-fermeture"
      />
      {/* Ce que fermer fait, et ce que fermer ne fait pas. Un commerce qui
          croirait annuler ses réservations en fermant sa journée se tairait
          auprès de créatrices qui viendront quand même. */}
      <Texte variante="type.caption" couleur="ink.soft">
        {t('composition.fermerNAnnuleRien')}
      </Texte>
      {echec ? <StatusMessage level="danger" body={echec} testID="echec-exception" /> : null}
      <Button
        label={t('composition.fermerCetteDate')}
        loading={envoi}
        disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)}
        onPress={() => void agir(() => api.fermerUneJournee(businessId, date))}
        testID="fermer-cette-date"
      />
    </View>
  );
}


/**
 * La semaine et ses exceptions, sans coquille.
 *
 * **Extrait pour que le lieu le porte.** Des heures d'ouverture décrivent un
 * endroit : elles vivent maintenant sur l'écran du lieu, à côté de la
 * couverture et de la carte. `HorairesScreen` reste pour la pile du téléphone,
 * où chaque section est un écran ; les deux rendent le même corps, parce que
 * deux corps finiraient par diverger et que c'est celui qu'on regarde le moins
 * qui dériverait.
 */
export function HorairesDuCommerce({
  semaine,
  businessId,
  onChange,
}: {
  semaine: Semaine;
  businessId: string;
  onChange: () => void;
}) {
  const { t } = useI18n();

  return (
        <View style={{ gap: 16 }}>
          <View style={{ gap: 8 }} testID="semaine">
            <Texte variante="type.label">{t('composition.ouverture')}</Texte>
            {JOURS.map((cle, jour) => (
              <LigneDeJour
                key={cle}
                libelle={t(cle)}
                jour={jour}
                regle={semaine.regles.find((r) => r.weekday === jour) ?? null}
                businessId={businessId}
                onChange={onChange}
              />
            ))}
            <Texte variante="type.caption" couleur="ink.soft">
              {t('composition.capaciteExplication')}
            </Texte>
          </View>

          <Exceptions
            exceptions={semaine.exceptions}
            businessId={businessId}
            onChange={onChange}
          />
        </View>
  );
}
