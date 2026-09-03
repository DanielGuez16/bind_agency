/**
 * L'image d'une publication archivée, partagée par les deux écrans qui la montrent.
 *
 * **Extrait de `MesPublicationsScreen`, et non recopié.** L'onglet des
 * réservations terminées devait montrer la même chose que le profil : la
 * publication qu'on a rendue. Deux copies du même crochet auraient divergé au
 * premier ajustement du droit de lecture — et c'est un droit signé qui expire,
 * donc l'écart se serait vu en production, sur une image qui ne charge plus
 * d'un seul côté.
 */
import { useEffect, useState } from 'react';

import { useApi } from '../../api';

/**
 * L'image de la publication, quand elle est archivée.
 *
 * **Le droit de lecture se demande, il ne se déduit pas d'une clé.** Une preuve
 * n'est jamais servie par une adresse devinable : l'API délivre un droit court
 * et signé, et c'est lui qui ouvre l'objet. La créatrice y a droit sur **sa**
 * publication — le serveur le vérifie sur la réservation, pas sur ce que
 * l'écran demande.
 *
 * **Rien n'est tenté sans objet.** `post_a_une_image` faux veut dire qu'aucun
 * fichier n'a été archivé ; demander quand même rendrait un 404 qui s'afficherait
 * comme une panne du produit.
 */
export function usePhotoDeLaPublication(
  proofId: string | null,
  aUneImage: boolean,
): string | null {
  const { api } = useApi();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!proofId || !aUneImage) {
      setUrl(null);
      return;
    }
    let vivant = true;
    void api
      .droitDeLireLaPreuve(proofId)
      .then((droit) => {
        if (vivant) setUrl(droit.url);
      })
      // **Avalé ici, et c'est la seule fois.** Sur la file du commerce une
      // image absente doit se dire : le salon approuve à l'aveugle sinon. Ici
      // la ligne reste lisible sans elle — le nom, le salon et la date sont là
      // — et un bandeau d'erreur par ligne ferait une page d'alertes.
      .catch(() => {
        if (vivant) setUrl(null);
      });
    return () => {
      vivant = false;
    };
  }, [api, aUneImage, proofId]);

  return url;
}
