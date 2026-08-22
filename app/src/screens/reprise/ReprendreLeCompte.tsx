/**
 * Reprendre un compte, et lire ce qu'on est en train de faire.
 *
 * **Un journal enregistre un abus, il ne l'empêche pas.** Personne n'a jamais
 * renoncé à quelque chose parce que ce serait écrit dans un fichier que
 * personne n'ouvre. Ce qui retient tient en trois mécanismes, et **aucun n'est
 * un contrôle d'accès** — cet écran n'interdit rien, il montre.
 *
 * **Le motif part au salon mot pour mot.** Pas résumé, pas catégorisé, pas
 * rangé sous une étiquette. Un administrateur qui sait que le gérant lira
 * exactement sa phrase l'écrit autrement — c'est le mécanisme lui-même, et
 * c'est pour cela que le champ le dit au-dessus de lui plutôt qu'en note.
 *
 * **La portée, et non la durée.** Une durée est une horloge, et une horloge se
 * renouvelle : il suffit de rouvrir quand la précédente s'éteint. Ce qu'on
 * déclare ici ne se renouvelle pas — et la liste est vraie, le serveur refuse
 * toute requête qui en sort. Un administrateur qui veut tout doit demander
 * tout, et « tout » se lit très mal dans la liste que le gérant consulte : il
 * n'est pas interdit, il est **écrit**.
 *
 * **« De ma propre initiative » est le défaut.** Faute d'un canal par lequel le
 * salon écrive, c'est celui qui affirme avoir été appelé qui doit le dire —
 * sans quoi toute reprise se présenterait comme sollicitée sans que personne ne
 * l'ait sollicitée.
 *
 * **Ce que cet écran ne peut pas encore faire, et c'est le frein principal.**
 * La planche veut que le compte des reprises de l'appelant se lise **au moment
 * de la demande** : « c'est ta quatrième ce mois-ci, tu en as fait une en
 * juillet ». Se comparer à soi-même est la seule comparaison qui change un
 * comportement sans accuser. Le compte est servi — mais sur la **réponse** à
 * l'ouverture, donc après. Il est donc rendu là où il arrive, ce qui retient
 * pour la suivante et non pour celle-ci. Demandé, voir `TASKS.md`.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { useApi, type PorteeDeReprise, type RepriseOuverte } from '../../api';
import { Button, Chip, StatusMessage, Texte, TextField } from '../../components';
import { useI18n } from '../../i18n';
import { radius, useColors } from '../../theme';
import { nomDeLEcran } from './portee';

/** Les sept portées, dans l'ordre où un salon les reconnaît. */
export const PORTEES: PorteeDeReprise[] = [
  'fiche',
  'catalogue',
  'agenda',
  'contreparties',
  'annuaire',
  'abonnement',
  'chiffres',
];

/**
 * « Tout », qui n'est pas une portée mais les sept.
 *
 * **Il n'est pas interdit, il est écrit.** Le serveur n'a pas de valeur
 * « tout » : demander tout, c'est cocher les sept, et le gérant lit alors les
 * sept dans sa liste. Une valeur unique aurait été plus courte à écrire et
 * plus facile à lire pour l'administrateur — c'est exactement ce qu'on ne veut
 * pas.
 */
export function toutEstDemande(portee: readonly PorteeDeReprise[]): boolean {
  return PORTEES.every((ecran) => portee.includes(ecran));
}

export function ReprendreLeCompte({
  businessId,
  nomDuSalon,
  onOuverte,
}: {
  businessId: string;
  nomDuSalon: string;
  onOuverte?: (reprise: RepriseOuverte) => void;
}) {
  const { api, messageDErreur } = useApi();
  const { t } = useI18n();
  const c = useColors();

  const [motif, setMotif] = useState('');
  const [portee, setPortee] = useState<PorteeDeReprise[]>([]);
  const [spontanee, setSpontanee] = useState(true);
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);
  const [ouverte, setOuverte] = useState<RepriseOuverte | null>(null);

  const complet = motif.trim().length > 0 && portee.length > 0;

  function basculer(ecran: PorteeDeReprise) {
    setPortee((actuelle) =>
      actuelle.includes(ecran)
        ? actuelle.filter((e) => e !== ecran)
        : [...actuelle, ecran],
    );
  }

  async function ouvrir() {
    setEchec(null);
    setEnvoi(true);
    try {
      const reprise = await api.ouvrirUneReprise(businessId, motif.trim(), portee, spontanee);
      setOuverte(reprise);
      onOuverte?.(reprise);
    } catch (erreur) {
      setEchec(messageDErreur(erreur));
    } finally {
      setEnvoi(false);
    }
  }

  if (ouverte) {
    return (
      <View style={{ gap: 12 }} testID="reprise-ouverte">
        <Texte variante="type.section">
          {t('reprise.ouverteTitre', { salon: nomDuSalon })}
        </Texte>
        {/* **Le compte, là où il arrive.** La planche le veut avant l'appui —
            se comparer à soi-même est la seule comparaison qui change un
            comportement sans accuser. Servi sur la réponse, il retient pour la
            suivante, ce qui est moins que ce qu'il devrait faire. */}
        <StatusMessage
          level="neutral"
          body={t('reprise.compteDeLAppelant', {
            n: String(ouverte.reprises_recentes_de_l_appelant),
            jours: String(ouverte.fenetre_en_jours),
          })}
          testID="reprise-compte"
        />
        <Texte variante="type.caption" couleur="ink.soft">
          {t('reprise.ouverteRappel', { salon: nomDuSalon })}
        </Texte>
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }} testID="reprendre-le-compte">
      <Texte variante="type.caption" couleur="ink.soft" testID="reprise-avertissement">
        {t('reprise.motLeMot', { salon: nomDuSalon })}
      </Texte>

      <TextField
        label={t('reprise.champMotif')}
        value={motif}
        onChangeText={setMotif}
        // Une seule ligne : `TextField` n'a pas de forme multiligne, et en
        // fabriquer une ici poserait un second champ de saisie hors du système.
        // Le motif est court par nature — c'est une phrase, pas un rapport.
        testID="champ-motif"
      />

      <View style={{ gap: 8 }}>
        <Texte variante="type.label" couleur="ink.soft">
          {t('reprise.porteeTitre')}
        </Texte>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PORTEES.map((ecran) => (
            <Chip
              key={ecran}
              label={nomDeLEcran(ecran, t)}
              selected={portee.includes(ecran)}
              onPress={() => basculer(ecran)}
              testID={`portee-${ecran}`}
            />
          ))}
        </View>

        {/* **« Tout » n'est pas interdit, il est écrit.** Le bord cramoisi ne
            barre rien : il rend visible ce que le gérant lira. */}
        {toutEstDemande(portee) ? (
          <View
            testID="reprise-tout"
            style={{
              padding: 12,
              borderRadius: radius['radius.lg'],
              borderWidth: 1,
              borderColor: c['status.danger.text'],
            }}
          >
            <Texte variante="type.caption" couleur="status.danger.text">
              {t('reprise.toutEcrit', { salon: nomDuSalon })}
            </Texte>
          </View>
        ) : null}
      </View>

      <View style={{ gap: 8 }}>
        <Texte variante="type.label" couleur="ink.soft">
          {t('reprise.origineTitre')}
        </Texte>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {/* **Le défaut est « de ma propre initiative ».** C'est celui qui
              affirme avoir été appelé qui doit le dire : sans cela, toute
              reprise se présenterait comme sollicitée. */}
          <Chip
            label={t('reprise.origineSpontanee')}
            selected={spontanee}
            onPress={() => setSpontanee(true)}
            testID="origine-spontanee"
          />
          <Chip
            label={t('reprise.origineDemandee')}
            selected={!spontanee}
            onPress={() => setSpontanee(false)}
            testID="origine-demandee"
          />
        </View>
        {spontanee ? (
          <Texte variante="type.caption" couleur="ink.soft" testID="reprise-spontanee-note">
            {t('reprise.spontaneeNote')}
          </Texte>
        ) : null}
      </View>

      {echec ? <StatusMessage level="danger" body={echec} testID="reprise-echec" /> : null}

      <Button
        label={t('reprise.ouvrir', { salon: nomDuSalon })}
        disabled={!complet}
        loading={envoi}
        onPress={() => void ouvrir()}
        testID="ouvrir-la-reprise"
      />
    </View>
  );
}
