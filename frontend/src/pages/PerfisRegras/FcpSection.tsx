import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Edit2,
  Percent,
  Plus,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { LoadingSpinner } from '../../components/feedback/LoadingSpinner';
import { SectionEmpty } from '../../components/feedback/SectionEmpty';
import { UFS_BRASIL } from '../../constants/domain';
import { formatPercent, parsePercentInput } from '../../lib/formatters';
import { parseCommaSeparatedTerms } from '../../lib/terms';
import type { RegraFcp } from '../../types/regraFcp';
import { CopiarRegrasButton } from './CopiarRegrasButton';
import { useFcpSection } from './useFcpSection';

const AJUDA_TERMOS =
  'Opcional: deixe em branco para enquadrar qualquer descrição do NCM/prefixo. ' +
  'Ou separe por vírgula e use * no fim para casar prefixo (ex.: refrigerant*, energetic*).';

const ALIQUOTA_FCP_PADRAO = '2,00';

const formatarAliquotaInput = (aliquota: number): string => {
  const pct = Math.round((aliquota * 100 + Number.EPSILON) * 10000) / 10000;
  const hasExtraDecimals = Math.abs(pct * 100 - Math.round(pct * 100)) > 1e-4;
  return (hasExtraDecimals ? String(pct) : pct.toFixed(2)).replace('.', ',');
};

const limparNcmPrefixo = (raw: string): string | null => {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 4 || digits.length > 8 || /^0+$/.test(digits)) {
    return null;
  }
  return digits;
};

interface Props {
  perfilId: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const FcpSection: React.FC<Props> = ({ perfilId, open, onOpenChange }) => {
  const {
    regras,
    criarRegra,
    atualizarRegra,
    deletarRegra,
    criarExcecao,
    deletarExcecao,
    carregarPresetBebidasBa,
    erro,
    setErro,
    presetResultado,
    setPresetResultado,
  } = useFcpSection(perfilId);

  const [modalRegraAberto, setModalRegraAberto] = useState(false);
  const [confirmPresetAberto, setConfirmPresetAberto] = useState(false);
  const [regraEditando, setRegraEditando] = useState<RegraFcp | null>(null);
  const [regraDaExcecao, setRegraDaExcecao] = useState<RegraFcp | null>(null);
  const [regraParaExcluir, setRegraParaExcluir] = useState<RegraFcp | null>(null);
  const [excecaoParaExcluir, setExcecaoParaExcluir] = useState<{
    regraId: number;
    excecaoId: number;
    descricao: string;
  } | null>(null);

  const [uf, setUf] = useState('BA');
  const [ncm, setNcm] = useState('');
  const [inclusao, setInclusao] = useState('');
  const [exclusao, setExclusao] = useState('');
  const [aliquota, setAliquota] = useState(ALIQUOTA_FCP_PADRAO);
  const [aplicarComTermoAcordo, setAplicarComTermoAcordo] = useState(true);
  const [descricao, setDescricao] = useState('');

  const [descricaoExata, setDescricaoExata] = useState('');
  const [enquadrado, setEnquadrado] = useState('nao');
  const [observacao, setObservacao] = useState('');

  const todasRegras = useMemo(() => regras.data ?? [], [regras.data]);

  const abrirModalCriacao = () => {
    setErro(null);
    setRegraEditando(null);
    setUf('BA');
    setNcm('');
    setInclusao('');
    setExclusao('');
    setAliquota(ALIQUOTA_FCP_PADRAO);
    setAplicarComTermoAcordo(true);
    setDescricao('');
    setModalRegraAberto(true);
  };

  const abrirModalEdicao = (regra: RegraFcp) => {
    setErro(null);
    setRegraEditando(regra);
    setUf(regra.uf || 'BA');
    setNcm(regra.ncm);
    setInclusao((regra.termos_inclusao ?? []).join(', '));
    setExclusao((regra.termos_exclusao ?? []).join(', '));
    setAliquota(formatarAliquotaInput(regra.aliquota));
    setAplicarComTermoAcordo(regra.aplicar_com_termo_acordo);
    setDescricao(regra.descricao || '');
    setModalRegraAberto(true);
  };

  const fecharModalRegra = () => {
    setErro(null);
    setModalRegraAberto(false);
    setRegraEditando(null);
  };

  const submeterRegra = (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);

    const ufLimpa = uf.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(ufLimpa)) {
      setErro('Informe uma UF válida com 2 letras.');
      return;
    }

    const ncmLimpo = limparNcmPrefixo(ncm);
    if (!ncmLimpo) {
      setErro('Informe um NCM ou prefixo válido de 4 a 8 dígitos não zerado.');
      return;
    }

    const aliquotaDecimal = parsePercentInput(aliquota);
    if (
      aliquotaDecimal === null ||
      !Number.isFinite(aliquotaDecimal) ||
      aliquotaDecimal <= 0 ||
      aliquotaDecimal > 1
    ) {
      setErro('Informe uma alíquota FCP maior que 0% e até 100%.');
      return;
    }

    const termosInclusao = parseCommaSeparatedTerms(inclusao);
    const termosExclusao = parseCommaSeparatedTerms(exclusao);

    if (regraEditando) {
      atualizarRegra.mutate(
        {
          id: regraEditando.id,
          payload: {
            uf: ufLimpa,
            ncm: ncmLimpo,
            termos_inclusao: termosInclusao,
            termos_exclusao: termosExclusao,
            aliquota: aliquotaDecimal,
            aplicar_com_termo_acordo: aplicarComTermoAcordo,
            descricao: descricao.trim() || null,
          },
        },
        { onSuccess: fecharModalRegra },
      );
      return;
    }

    criarRegra.mutate(
      {
        perfil_regras_id: perfilId,
        uf: ufLimpa,
        ncm: ncmLimpo,
        termos_inclusao: termosInclusao,
        termos_exclusao: termosExclusao,
        aliquota: aliquotaDecimal,
        aplicar_com_termo_acordo: aplicarComTermoAcordo,
        descricao: descricao.trim() || null,
      },
      { onSuccess: fecharModalRegra },
    );
  };

  const submeterExcecao = (e: React.FormEvent) => {
    e.preventDefault();
    if (!regraDaExcecao) return;
    setErro(null);
    criarExcecao.mutate(
      {
        regraId: regraDaExcecao.id,
        payload: {
          descricao_exata: descricaoExata,
          enquadrado: enquadrado === 'sim',
          observacao: observacao.trim() || null,
        },
      },
      {
        onSuccess: () => {
          setDescricaoExata('');
          setObservacao('');
          setEnquadrado('nao');
          setRegraDaExcecao(null);
        },
      },
    );
  };

  const confirmarPresetBebidasBa = () => {
    setErro(null);
    carregarPresetBebidasBa.mutate(perfilId, {
      onSettled: () => setConfirmPresetAberto(false),
    });
  };

  return (
    <>
      <Card
        collapsible
        open={open}
        onOpenChange={onOpenChange}
        bodyPadding="none"
        title="FCP — Fundo de Combate à Pobreza"
        subtitle="Regras por UF, NCM/prefixo e descrição que apuram o FCP em separado (aba FCP da planilha)."
        summary={<span>{todasRegras.length} regra(s)</span>}
        headerAction={
          <>
            <CopiarRegrasButton
              perfilId={perfilId}
              secao="fcp"
              label="Copiar para..."
              descricao="Copia todas as regras de FCP deste perfil, com suas exceções."
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setErro(null);
                setConfirmPresetAberto(true);
              }}
              leftIcon={<Sparkles className="h-3.5 w-3.5 text-amber-600" />}
            >
              Carregar padrão Bebidas BA (2%)
            </Button>
            <Button
              size="sm"
              onClick={abrirModalCriacao}
              leftIcon={<Plus className="h-3.5 w-3.5" />}
            >
              Nova regra FCP
            </Button>
          </>
        }
      >
        {(erro && !modalRegraAberto && !regraDaExcecao) || presetResultado ? (
          <div className="space-y-3 p-5 pb-0">
            {erro && !modalRegraAberto && !regraDaExcecao && (
              <ErrorAlert
                title="Erro na operação de FCP"
                message={erro}
                onDismiss={() => setErro(null)}
              />
            )}

            {presetResultado && (
              <div className="flex items-start justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div className="space-y-0.5">
                    <p className="font-semibold">Padrão Bebidas BA (2%) processado</p>
                    <p className="text-emerald-800">
                      Regras FCP: <strong>{presetResultado.fcp_criadas}</strong> criada(s),{' '}
                      <strong>{presetResultado.fcp_ignoradas}</strong> já existente(s). Exceções de
                      alíquota 25% (NCM): <strong>{presetResultado.aliquotas_criadas}</strong>{' '}
                      criada(s), <strong>{presetResultado.aliquotas_ignoradas}</strong> já existente(s).
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Fechar aviso"
                  className="cursor-pointer rounded p-1 text-emerald-700 transition-colors hover:bg-emerald-100 hover:text-emerald-900"
                  onClick={() => setPresetResultado(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        ) : null}

        {regras.isLoading ? (
          <div className="p-5">
            <LoadingSpinner size="sm" message="Carregando regras de FCP..." />
          </div>
        ) : todasRegras.length > 0 ? (
          <div className="overflow-x-auto pt-3">
            <table className="w-full divide-y divide-slate-100 text-left text-xs">
              <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">UF</th>
                  <th className="px-3 py-2.5 font-mono">NCM / Prefixo</th>
                  <th className="px-3 py-2.5">Termos de inclusão</th>
                  <th className="px-3 py-2.5">Termos de exclusão</th>
                  <th className="px-3 py-2.5 text-right">% FCP</th>
                  <th className="px-3 py-2.5">Termo de Acordo</th>
                  <th className="px-3 py-2.5">Descrição</th>
                  <th className="px-3 py-2.5">Exceções por descrição</th>
                  <th className="px-3 py-2.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/80">
                {todasRegras.map((regra) => (
                  <tr key={regra.id} className="align-top transition-colors hover:bg-slate-50/70">
                    <td className="px-3 py-2.5">
                      <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-800">
                        {regra.uf}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-800">
                        {regra.ncm}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {regra.termos_inclusao.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {regra.termos_inclusao.map((termo) => (
                            <span
                              key={termo}
                              className="rounded border border-blue-200/80 bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-blue-800"
                            >
                              {termo}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] italic text-slate-400">Qualquer descrição</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {regra.termos_exclusao.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {regra.termos_exclusao.map((termo) => (
                            <span
                              key={termo}
                              className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600"
                            >
                              {termo}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400">&mdash;</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums text-blue-950">
                      {formatPercent(regra.aliquota)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge
                        variant={regra.aplicar_com_termo_acordo ? 'success' : 'neutral'}
                        size="sm"
                      >
                        {regra.aplicar_com_termo_acordo ? 'Sim' : 'Não'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{regra.descricao || '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="space-y-1">
                        {regra.excecoes.map((exc) => (
                          <div key={exc.id} className="flex items-center gap-1">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                                exc.enquadrado
                                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
                                  : 'bg-amber-50 text-amber-800 ring-amber-600/20'
                              }`}
                              title={exc.enquadrado ? 'Enquadrado no FCP' : 'Fora do FCP'}
                            >
                              {exc.enquadrado ? (
                                <Check className="h-3 w-3 shrink-0" />
                              ) : (
                                <X className="h-3 w-3 shrink-0" />
                              )}
                              {exc.descricao_exata}
                            </span>
                            <button
                              type="button"
                              className="cursor-pointer rounded p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-700"
                              aria-label={`Remover exceção ${exc.descricao_exata}`}
                              onClick={() =>
                                setExcecaoParaExcluir({
                                  regraId: regra.id,
                                  excecaoId: exc.id,
                                  descricao: exc.descricao_exata,
                                })
                              }
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="min-h-0 px-2 py-1"
                          onClick={() => {
                            setErro(null);
                            setRegraDaExcecao(regra);
                          }}
                          leftIcon={<Plus className="h-3 w-3" />}
                        >
                          Exceção
                        </Button>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <CopiarRegrasButton
                          perfilId={perfilId}
                          secao="fcp"
                          regraIds={[regra.id]}
                          descricao="Copia esta regra de FCP, com suas exceções."
                        />
                        <button
                          type="button"
                          onClick={() => abrirModalEdicao(regra)}
                          className="cursor-pointer rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-700"
                          title="Editar regra FCP"
                          aria-label={`Editar regra FCP do NCM ${regra.ncm}`}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setRegraParaExcluir(regra)}
                          className="cursor-pointer rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-700"
                          title="Excluir regra FCP"
                          aria-label={`Excluir regra FCP do NCM ${regra.ncm}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5">
            <SectionEmpty
              icon={<Percent className="h-6 w-6" />}
              title="Nenhuma regra de FCP cadastrada"
              hint="Cadastre regras manuais ou carregue o padrão Bebidas BA (2%) para apurar o FCP em aba separada na planilha."
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={abrirModalCriacao}
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                >
                  Cadastrar regra FCP
                </Button>
              }
            />
          </div>
        )}
      </Card>

      <Modal
        isOpen={modalRegraAberto}
        onClose={fecharModalRegra}
        title={regraEditando ? 'Editar regra de FCP' : 'Nova regra de FCP'}
        subtitle="Define o adicional de FCP por UF, NCM/prefixo e termos opcionais da descrição."
      >
        <form onSubmit={submeterRegra} className="space-y-4">
          {erro && (
            <ErrorAlert
              title="Erro ao salvar regra FCP"
              message={erro}
              onDismiss={() => setErro(null)}
            />
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="UF"
              value={uf}
              onChange={(e) => setUf(e.target.value)}
              options={UFS_BRASIL.map((sigla) => ({ value: sigla, label: sigla }))}
              required
            />
            <Input
              label="Alíquota FCP (%)"
              value={aliquota}
              onChange={(e) => setAliquota(e.target.value)}
              placeholder={ALIQUOTA_FCP_PADRAO}
              helperText="Informe o percentual (ex.: 2,00 para 2%)."
              required
            />
          </div>
          <Input
            label="NCM ou prefixo (4 a 8 dígitos)"
            value={ncm}
            onChange={(e) => setNcm(e.target.value)}
            placeholder="2203 ou 22021000"
            required
          />
          <Input
            label="Termos de inclusão (opcional)"
            value={inclusao}
            onChange={(e) => setInclusao(e.target.value)}
            placeholder="refrigerant*, energetic* (vazio = todo o NCM)"
            helperText={AJUDA_TERMOS}
          />
          <Input
            label="Termos de exclusão (opcional)"
            value={exclusao}
            onChange={(e) => setExclusao(e.target.value)}
            placeholder="agua mineral, suco natural"
            helperText="Se algum destes casar, a regra de FCP é descartada para o item."
          />
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200/90 bg-slate-50/70 p-3 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={aplicarComTermoAcordo}
              onChange={(e) => setAplicarComTermoAcordo(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span>
              <strong className="block font-semibold text-slate-900">
                Aplicar quando empresa tiver Termo de Acordo
              </strong>
              <span className="text-slate-500">
                Mantém a cobrança do FCP mesmo quando a empresa opera sob Termo de Acordo.
              </span>
            </span>
          </label>
          <Input
            label="Descrição (opcional)"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="FCP 2% — Cervejas de malte (Lei BA 7.014/96, art. 16-A)"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={fecharModalRegra}>
              Cancelar
            </Button>
            <Button
              type="submit"
              isLoading={criarRegra.isPending || atualizarRegra.isPending}
            >
              {regraEditando ? 'Salvar alterações' : 'Cadastrar'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={regraDaExcecao !== null}
        onClose={() => {
          setErro(null);
          setRegraDaExcecao(null);
        }}
        title="Exceção para uma descrição específica"
        subtitle="Avaliada antes dos termos: resolve o caso que a regra erra, sem alterar a regra."
      >
        <form onSubmit={submeterExcecao} className="space-y-4">
          {erro && (
            <ErrorAlert
              title="Erro ao cadastrar exceção"
              message={erro}
              onDismiss={() => setErro(null)}
            />
          )}
          <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600" />
            <span>
              Informe a descrição como ela aparece na nota. Acento, caixa e pontuação são
              normalizados automaticamente.
            </span>
          </div>
          <Input
            label="Descrição exata"
            value={descricaoExata}
            onChange={(e) => setDescricaoExata(e.target.value)}
            placeholder="AGUA MINERAL NATURAL"
            required
          />
          <Select
            label="Este produto se enquadra no FCP?"
            value={enquadrado}
            onChange={(e) => setEnquadrado(e.target.value)}
            options={[
              { value: 'nao', label: 'Fora do FCP — não aplicar FCP' },
              { value: 'sim', label: 'Enquadrado no FCP — aplicar FCP' },
            ]}
          />
          <Input
            label="Observação (opcional)"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Produto isento de FCP"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setErro(null);
                setRegraDaExcecao(null);
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" isLoading={criarExcecao.isPending}>
              Cadastrar exceção
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={confirmPresetAberto}
        onClose={() => setConfirmPresetAberto(false)}
        onConfirm={confirmarPresetBebidasBa}
        title="Carregar padrão Bebidas BA (2%)"
        message="Serão adicionadas as regras de FCP 2% da Bahia para bebidas (NCMs 2203, 2204, 2205, 2206, 2208, 22029100, 22021000 e 22029900) e as exceções de alíquota base de 25% em Exceções Tributárias por NCM (2203 a 2208). Regras já existentes não serão sobrescritas."
        confirmLabel="Carregar padrão"
        cancelLabel="Cancelar"
        variant="primary"
        isLoading={carregarPresetBebidasBa.isPending}
      />

      <ConfirmDialog
        isOpen={Boolean(regraParaExcluir)}
        onClose={() => setRegraParaExcluir(null)}
        onConfirm={() => {
          if (regraParaExcluir) {
            deletarRegra.mutate(regraParaExcluir.id, {
              onSettled: () => setRegraParaExcluir(null),
            });
          }
        }}
        title="Excluir Regra de FCP"
        message={`Deseja remover permanentemente a regra FCP de ${regraParaExcluir?.uf} para o NCM ${regraParaExcluir?.ncm}?`}
        confirmLabel="Sim, Excluir"
        cancelLabel="Cancelar"
        variant="danger"
        isLoading={deletarRegra.isPending}
      />

      <ConfirmDialog
        isOpen={Boolean(excecaoParaExcluir)}
        onClose={() => setExcecaoParaExcluir(null)}
        onConfirm={() => {
          if (excecaoParaExcluir) {
            deletarExcecao.mutate(
              { regraId: excecaoParaExcluir.regraId, excecaoId: excecaoParaExcluir.excecaoId },
              { onSettled: () => setExcecaoParaExcluir(null) },
            );
          }
        }}
        title="Remover Exceção de Descrição"
        message={`Deseja remover a exceção para "${excecaoParaExcluir?.descricao}"?`}
        confirmLabel="Sim, Remover"
        cancelLabel="Cancelar"
        variant="danger"
        isLoading={deletarExcecao.isPending}
      />
    </>
  );
};
