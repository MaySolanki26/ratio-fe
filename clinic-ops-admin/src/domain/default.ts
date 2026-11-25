/** Registers the default domain pack (Rentio) before the store loads. */
import { registerDefaultDomain } from './active';
import { rentioDomain } from './rentio/domain';

registerDefaultDomain(rentioDomain);
