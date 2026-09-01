/**
 * Le diagnostic de connexion, dans les réglages.
 *
 * **Il interroge l'adresse que l'application utilise vraiment**, pas une
 * variable d'environnement. Il lisait `EXPO_PUBLIC_API_URL` directement ;
 * depuis que l'adresse se déduit du serveur de développement, cette variable
 * est vide, et le diagnostic annonçait « aucune adresse configurée » sur une
 * application qui joignait l'API parfaitement. Un diagnostic qui ne regarde pas
 * ce que fait le produit ne diagnostique rien.
 *
 * **Il dit ce qu'il cherche.** Il s'ouvre sur la question à laquelle il répond,
 * puis sur l'adresse interrogée : sans elles, « API reachable » ne se relie à
 * rien de ce que l'on voit à l'écran.
 *
 * **Le bouton se voit travailler.** Il repassait par un état d'échec immédiat
 * quand l'adresse manquait, sans jamais rien afficher entre-temps : rien ne
 * bougeait, et il paraissait mort. Il est désactivé pendant la sonde.
 *
 * **La sonde a une échéance, et l'attente se dit.** Elle appelait `fetch` sans
 * délai : sur un hébergeur qui endort le service, la première requête met une
 * minute, et l'écran restait sur « chargement » sans rien indiquer — le
 * diagnostic paraissait cassé alors qu'il diagnostiquait exactement ce qu'il
 * fallait. Au-delà de quelques secondes, il dit que le serveur se réveille ;
 * au-delà de l'échéance, il abandonne et le dit aussi.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Button, DataRow, StatusMessage, Texte } from '../components';
import { useI18n } from '../i18n';
import { errorCodeFromResponse, translateErrorCode } from '../i18n/errors';
import { adresseDeLApi } from '../shell/adresseDeLApi';

type Health = {
  status: 'ok' | 'unavailable';
  dependencies: Record<string, string>;
  failed: string[];
};

/** Au-delà, on cesse d'attendre. Un réveil de service prend environ une minute. */
const ECHEANCE_MS = 75_000;

/** Passé ce délai sans réponse, l'attente s'explique au lieu de se subir. */
const REVEIL_PROBABLE_MS = 4_000;

type Sonde =
  | { etat: 'encours'; long: boolean }
  | { etat: 'repondu'; corps: Health }
  | { etat: 'echec'; code: string | null };

export function HealthScreen({ apiUrl }: { apiUrl?: string | null }) {
  const { t } = useI18n();
  // Résolue au rendu et non en constante de module : une constante fige la
  // valeur au chargement du bundle, avant que la déduction soit possible.
  const adresse = apiUrl === undefined ? adresseDeLApi() : apiUrl;
  const [sonde, setSonde] = useState<Sonde>({ etat: 'encours', long: false });

  // La sonde est asynchrone : sans cette garde, une réponse qui arrive après
  // un démontage écrit dans un composant qui n'existe plus.
  const monte = useRef(true);
  useEffect(() => {
    monte.current = true;
    return () => {
      monte.current = false;
    };
  }, []);

  const publie = useCallback((resultat: Sonde) => {
    if (monte.current) setSonde(resultat);
  }, []);

  const sonder = useCallback(async () => {
    publie({ etat: 'encours', long: false });

    if (!adresse) {
      publie({ etat: 'echec', code: null });
      return;
    }

    // Au bout de quelques secondes, l'attente cesse d'être muette : sur un
    // hébergeur qui endort le service, c'est la situation normale, pas une
    // panne.
    const lent = setTimeout(() => publie({ etat: 'encours', long: true }), REVEIL_PROBABLE_MS);
    const abandon = new AbortController();
    const echeance = setTimeout(() => abandon.abort(), ECHEANCE_MS);

    try {
      const reponse = await fetch(`${adresse}/health`, { signal: abandon.signal });
      const corps = await reponse.json();
      if (reponse.status >= 400) {
        // Le corps peut porter un code du catalogue, ou rien d'exploitable.
        publie({ etat: 'echec', code: errorCodeFromResponse(corps) });
        return;
      }
      publie({ etat: 'repondu', corps });
    } catch {
      publie({ etat: 'echec', code: null });
    } finally {
      clearTimeout(lent);
      clearTimeout(echeance);
    }
  }, [adresse, publie]);

  useEffect(() => {
    void sonder();
  }, [sonder]);

  return (
    // `ecran-sante` remplace `diagnostic-connexion` : le nœud est le même —
    // la racine de l'écran — et personne ne visait l'ancien nom. Un écran se
    // nomme par ce qu'il est, pas par le premier bloc qu'il porte.
    <View style={{ gap: 12 }} testID="ecran-sante">
      <DataRow label={t('health.address')} value={adresse ?? '—'} />

      {sonde.etat === 'encours' ? (
        <StatusMessage
          level="neutral"
          body={sonde.long ? t('health.reveil') : t('common.loading')}
          testID="diagnostic-encours"
        />
      ) : null}

      {sonde.etat === 'repondu' ? (
        <View style={{ gap: 6 }} testID="diagnostic-repondu">
          <StatusMessage
            level={sonde.corps.status === 'ok' ? 'neutral' : 'danger'}
            body={sonde.corps.status === 'ok' ? t('health.reachable') : t('health.unreachable')}
          />
          {Object.entries(sonde.corps.dependencies).map(([nom, etat]) => (
            <DataRow
              key={nom}
              // `nom` vient du serveur et n'est pas un libellé d'interface.
              label={nom}
              value={etat === 'ok' ? t('health.dependencyOk') : t('health.dependencyDown')}
            />
          ))}
        </View>
      ) : null}

      {sonde.etat === 'echec' ? (
        <View style={{ gap: 6 }} testID="diagnostic-echec">
          <StatusMessage
            level="danger"
            body={adresse ? t('health.unreachable') : t('health.missingApiUrl')}
          />
          <Texte variante="type.caption" couleur="ink.soft">
            {adresse ? translateErrorCode(t, sonde.code) : t('health.missingApiUrlHelp')}
          </Texte>
        </View>
      ) : null}

      <Button
        label={t('common.retry')}
        variant="secondary"
        loading={sonde.etat === 'encours'}
        onPress={() => void sonder()}
        testID="diagnostic-refaire"
      />
    </View>
  );
}
