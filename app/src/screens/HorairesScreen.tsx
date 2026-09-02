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
import { Pressable, View } from 'react-native';

import { useApi, type ExceptionDeCapacite, type RegleDeCapacite } from '../api';
import {
  Button,
  SkeletonLignes,
  StatusMessage,
  Icone,
  Stepper,
  Texte,
  TextField,
  vibration,
} from '../components';
import { useI18n } from '../i18n';
import { radius, size, useColors } from '../theme';
import { formatDate, formatJour } from '../format';
import { Ecran } from './Ecran';

/**
 * Les trente prochains jours, date civile en ISO.
 *
 * Trente parce qu'une fermeture se décide à quelques semaines : au-delà, la
 * grille devient un calendrier, et un calendrier demande un composant que le
 * système n'a pas.
 */
const PROCHAINS_JOURS = (): string[] =>
  Array.from({ length: 30 }, (_, i) => {
    const jour = new Date(Date.now() + i * 24 * 3_600_000);
    return jour.toISOString().slice(0, 10);
  });

/** Le nom court du jour, pour que la grille dise autre chose qu'un numéro. */
const nomDeJour = (jour: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${jour}T12:00:00Z`),
  );

import { useRequete } from './useRequete';
import { etatAccessible } from '../components/etatAccessible';

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
/**
 * Les deux largeurs fixes du tableau, **mesurées et non données**.
 *
 * Un tableau ne se compose pas en posant des largeurs : il se compose sur la
 * plus longue valeur de chaque colonne, dans les deux langues. « Wednesday »
 * demande 93 points et 92 les coupait ; « miércoles » en demande davantage.
 * La colonne du milieu prend ce qui reste — c'est elle qui porte la valeur la
 * plus variable.
 *
 * **Mesurer plutôt que tronquer, et c'est aussi ce que le dépôt exige.**
 * `numberOfLines` est réservé aux noms propres : ni un jour ni une amplitude
 * n'en est un. La planche demande « sans retour » ; la largeur juste le donne
 * sans rien couper, une ellipse l'aurait donné en perdant la fin du mot.
 */
const LARGEUR_DU_JOUR = 104;

/**
 * La hauteur d'une rangée, **la même dans les deux tables**.
 *
 * Les horaires et les exceptions disent la même chose — un jour, et ce qui s'y
 * passe — et portaient deux échelles. Ce qui les distingue est leur intertitre,
 * pas leur typographie.
 */
const HAUTEUR_DE_RANGEE = 60;

/**
 * Les chiffres alignés en colonne. **Sur les valeurs, jamais sur le jeton.**
 *
 * Redéfinir `type.data` pour aligner ce tableau emporterait les codes de
 * retrait, les seuils et les dates d'exception — un test le refuse, et il a
 * raison.
 */
const TABULAIRE = { fontVariant: ['tabular-nums' as const] };

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
  const c = useColors();
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
    <View testID={`jour-${jour}`}>
      {/* **Une rangée de tableau, et le chevron est parti.** La rangée entière
          s'ouvre : sept chevrons répétaient sept fois la même promesse, et les
          trente-deux points rendus donnent à la colonne des heures de quoi ne
          pas se couper.

          **Le fond retiré des jours fermés part aussi.** Il disait « cette
          ligne existe et ne porte rien » quand la ligne était seule au monde ;
          dans un tableau, la cellule de fauteuils vide le dit déjà, et deux
          signes pour un fait en font un à interpréter. */}
      <Pressable
        onPress={() => setOuvert(!ouvert)}
        testID={`modifier-${jour}`}
        accessibilityRole="button"
        accessibilityLabel={libelle}
        style={({ pressed }) => ({
          minHeight: HAUTEUR_DE_RANGEE,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          borderBottomWidth: 1,
          borderBottomColor: c['line.default'],
          // **Le jour fermé garde sa ligne, en fond retiré.** Le retirer ferait
          // une semaine à cinq lignes où l'on chercherait le jeudi. Le fond
          // était superflu tant qu'une cellule vide le disait déjà ; la colonne
          // des fauteuils partie, il redevient le seul signe.
          ...(regle ? null : { backgroundColor: c['bg.page'] }),
          opacity: pressed ? 0.7 : 1,
        })}
      >
        {/* **104 points, mesurés et non donnés.** Un tableau se compose sur la
            plus longue valeur de chaque colonne, dans les deux langues :
            « Wednesday » en demande 93, « miércoles » davantage. La même
            largeur sert aux exceptions — c'est ce qui fait des deux tables une
            seule grammaire. */}
        <Texte
          variante="type.bodyStrong"
          couleur={regle ? 'ink.default' : 'ink.mute'}
          style={{ width: LARGEUR_DU_JOUR }}
        >
          {libelle}
        </Texte>

        <View style={{ flex: 1, minWidth: 0 }}>
          {regle ? (
            /* **L'amplitude en chiffres tabulaires**, pour que les sept mesurent
               pareil. Elle reste hors du mono : une amplitude est une phrase
               brève entre deux heures, pas un identifiant.

               **Et la capacité n'y est plus.** L'exposer sur chaque ligne
               demandait de tenir deux idées par jour ; elle se règle en ouvrant
               le jour, où la phrase peut être entière. */
            <Texte
              variante="type.body"
              couleur="ink.default"
              style={TABULAIRE}
              testID={`horaires-${jour}`}
            >
              {t('commerce.horairesDe', {
                debut: regle.start_time.slice(0, 5),
                fin: regle.end_time.slice(0, 5),
              })}
            </Texte>
          ) : (
            /* Écrit, jamais absent : une ligne manquante ne dit pas si le jour
               est fermé ou si le commerce n'a rien rempli. */
            <Texte variante="type.body" couleur="ink.mute" testID={`ferme-${jour}`}>
              {t('composition.ferme')}
            </Texte>
          )}
        </View>

        {/* **Une marque, pas une cible.** La v12 l'avait retiré parce que sept
            chevrons répétaient sept fois la même promesse ; ce qu'elle visait
            est la redondance de promesse, et elle ne revient pas : la rangée
            entière reste la seule zone cliquable, rien d'autre dedans ne l'est.
            C'est le mot que `primitives.json` emploie pour le glyphe de sortie,
            et le motif déjà admis pour la pilule de profil. */}
        <Icone nom="chevron" couleur="ink.soft" taille={20} />
      </Pressable>

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
  const c = useColors();
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
      <Texte variante="type.label" couleur="ink.soft">
        {t('composition.exceptions').toUpperCase()}
      </Texte>

      {exceptions.length === 0 ? (
        <Texte variante="type.caption" couleur="ink.mute" testID="aucune-exception">
          {t('composition.aucuneException')}
        </Texte>
      ) : (
        exceptions.map((exception) => (
          <View
            key={exception.id}
            style={{
              minHeight: HAUTEUR_DE_RANGEE,
              paddingHorizontal: 16,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              borderBottomWidth: 1,
              borderBottomColor: c['line.default'],
            }}
            testID={`exception-${exception.id}`}
          >
            {/* **La même colonne de 104, la même graisse, la même hauteur.**
                Les deux tables disent un jour et ce qui s'y passe ; elles
                portaient deux échelles, et le mono faisait de la date une
                donnée là où c'est une phrase. Ce qui les distingue est leur
                intertitre, pas leur typographie. */}
            <Texte variante="type.bodyStrong" style={{ width: LARGEUR_DU_JOUR }}>
              {formatJour(exception.date, locale)}
            </Texte>
            <Texte variante="type.body" couleur="ink.mute" style={{ flex: 1, minWidth: 0 }}>
              {t('composition.ferme')}
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

      {/* **Une date se choisit, elle ne s'épelle pas.** C'était un champ de
          texte avec un format en légende : on y tapait un jour dans une syntaxe
          à retenir, sans savoir quel jour de la semaine on fermait, et une
          faute de frappe fermait une autre date que celle qu'on visait.

          En grille qui se replie, jamais en défilement horizontal : une date
          qui sort de l'écran est une date qu'on ne choisira pas. */}
      <Texte variante="type.label" couleur="ink.soft">
        {t('composition.champDateDeFermeture')}
      </Texte>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} testID="choix-de-la-date">
        {PROCHAINS_JOURS().map((jour) => {
          const choisi = jour === date;
          return (
            <Pressable
              key={jour}
              accessibilityRole="button"
              {...etatAccessible({ selected: choisi })}
              accessibilityLabel={formatDate(`${jour}T12:00:00Z`, locale, 'UTC')}
              onPress={() => setDate(choisi ? '' : jour)}
              testID={`jour-${jour}`}
              style={({ pressed }) => ({
                minHeight: size.touchMin,
                minWidth: 52,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 10,
                borderRadius: radius['radius.sm'],
                borderWidth: choisi ? 2 : 1,
                borderColor: choisi ? c['brand.700'] : c['line.default'],
                backgroundColor: choisi ? c['brand.50'] : 'transparent',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Texte variante="type.dataLabel" couleur="ink.soft">
                {nomDeJour(jour, locale)}
              </Texte>
              <Texte variante="type.data">{jour.slice(8)}</Texte>
            </Pressable>
          );
        })}
      </View>
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
  const c = useColors();

  return (
        <View style={{ gap: 16 }}>
          <View style={{ gap: 8 }} testID="semaine">
            {/* **L'en-tête porte les trois concepts une fois.** Les sept
                lignes répétaient six fois la définition d'une colonne : « 2
                creators at once » portait à la fois la valeur et son
                explication. Dit en tête, le mot ne se redit pas. */}
            <Texte variante="type.body" couleur="ink.soft" testID="capacite-explication">
              {t('composition.capaciteExplication')}
            </Texte>
            <Texte variante="type.label" couleur="ink.soft">
              {t('composition.sectionChaqueSemaine').toUpperCase()}
            </Texte>
            <View
              testID="entete-du-tableau"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                height: 40,
                paddingHorizontal: 16,
                backgroundColor: c['bg.page'],
                borderBottomWidth: 1,
                borderBottomColor: c['line.strong'],
              }}
            >
              <Texte variante="type.label" couleur="ink.soft" style={{ width: LARGEUR_DU_JOUR }}>
                {t('composition.colonneJour').toUpperCase()}
              </Texte>
              <Texte variante="type.label" couleur="ink.soft" style={{ flex: 1, minWidth: 0 }}>
                {t('composition.colonneOuvert').toUpperCase()}
              </Texte>
            </View>
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
          </View>

          <Exceptions
            exceptions={semaine.exceptions}
            businessId={businessId}
            onChange={onChange}
          />
        </View>
  );
}
