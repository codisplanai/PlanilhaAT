import React, { useState } from 'react';
import { Plus, Trash2, TriangleAlert } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { ErrorAlert } from '../../components/feedback/ErrorAlert';
import { useReducaoProdutoSection } from './useReducaoProdutoSection';
import type { RegraReducao } from '../../types/regraReducao';

const AJUDA_TERMOS =
  'Separe por vírgula. Use * no fim para casar prefixo: vergalh* pega VERGALHAO e ' +
  'VERGALHOES. O termo casa palavras inteiras — ferro não casa FERROVIARIO.';

const listaDeTermos = (texto: string): string[] =>
  texto.split(',').map((t) => t.trim()).filter(Boolean);

const percentual = (aliquota: number): string => `${(aliquota * 100).toFixed(2)}%`;

interface Props {
  perfilId: number;
}

export const ReducaoProdutoSection: React.FC<Props> = ({ perfilId }) => {
  const { regras, criarRegra, deletarRegra, criarExcecao, deletarExcecao, erro, setErro } =
    useReducaoProdutoSection(perfilId);

  const [modalRegraAberto, setModalRegraAberto] = useState(false);
  const [regraDaExcecao, setRegraDaExcecao] = useState<RegraReducao | null>(null);

  const [ncm, setNcm] = useState('');
  const [inclusao, setInclusao] = useState('');
  const [exclusao, setExclusao] = useState('');
  const [aliquota, setAliquota] = useState('');
  const [descricao, setDescricao] = useState('');

  const [descricaoExata, setDescricaoExata] = useState('');
  const [enquadrado, setEnquadrado] = useState('nao');
  const [observacao, setObservacao] = useState('');

  const limparFormRegra = () => {
    setNcm(''); setInclusao(''); setExclusao(''); setAliquota(''); setDescricao('');
  };

  const submeterRegra = (e: React.FormEvent) => {
    e.preventDefault();
    criarRegra.mutate(
      {
        perfil_regras_id: perfilId,
        ncm,
        termos_inclusao: listaDeTermos(inclusao),
        termos_exclusao: listaDeTermos(exclusao),
        aliquota: Number(aliquota.replace(',', '.')),
        descricao: descricao || null,
      },
      { onSuccess: () => { limparFormRegra(); setModalRegraAberto(false); } },
    );
  };

  const submeterExcecao = (e: React.FormEvent) => {
    e.preventDefault();
    if (!regraDaExcecao) return;
    criarExcecao.mutate(
      {
        regraId: regraDaExcecao.id,
        payload: {
          descricao_exata: descricaoExata,
          enquadrado: enquadrado === 'sim',
          observacao: observacao || null,
        },
      },
      {
        onSuccess: () => {
          setDescricaoExata(''); setObservacao(''); setEnquadrado('nao');
          setRegraDaExcecao(null);
        },
      },
    );
  };

  return (
    <>
      <Card
        title="Reduções por Produto (NCM + Descrição) — Prioridade Máxima"
        subtitle="Aplicada quando o NCM E a descrição do item conferem. Vence o termo de acordo da empresa e as demais regras."
        headerAction={
          <Button
            size="sm"
            onClick={() => { setErro(null); setModalRegraAberto(true); }}
            leftIcon={<Plus className="w-3.5 h-3.5" />}
          >
            Nova redução
          </Button>
        }
      >
        {erro && <ErrorAlert message={erro} />}

        {regras.data && regras.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-4">NCM</th>
                  <th className="py-2 pr-4">Inclusão</th>
                  <th className="py-2 pr-4">Exclusão</th>
                  <th className="py-2 pr-4">Alíquota</th>
                  <th className="py-2 pr-4">Descrição</th>
                  <th className="py-2 pr-4">Exceções</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {regras.data.map((regra) => (
                  <tr key={regra.id} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-4 font-mono text-xs">{regra.ncm}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{regra.termos_inclusao.join(', ')}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-500">
                      {regra.termos_exclusao.join(', ') || '—'}
                    </td>
                    <td className="py-2 pr-4 font-semibold">{percentual(regra.aliquota)}</td>
                    <td className="py-2 pr-4 text-slate-600">{regra.descricao || '—'}</td>
                    <td className="py-2 pr-4">
                      <div className="space-y-1">
                        {regra.excecoes.map((exc) => (
                          <div key={exc.id} className="flex items-center gap-2 text-xs">
                            <span className={exc.enquadrado ? 'text-emerald-700' : 'text-amber-700'}>
                              {exc.enquadrado ? '✓' : '✕'} {exc.descricao_exata}
                            </span>
                            <button
                              type="button"
                              className="text-slate-400 hover:text-red-600 cursor-pointer"
                              onClick={() =>
                                deletarExcecao.mutate({ regraId: regra.id, excecaoId: exc.id })}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setErro(null); setRegraDaExcecao(regra); }}
                        >
                          + exceção
                        </Button>
                      </div>
                    </td>
                    <td className="py-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deletarRegra.mutate(regra.id)}
                        leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                      >
                        Excluir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Nenhuma redução cadastrada. Sem regra aqui, todos os produtos usam o termo de
            acordo da empresa ou a alíquota padrão do estado.
          </p>
        )}
      </Card>

      <Modal
        isOpen={modalRegraAberto}
        onClose={() => setModalRegraAberto(false)}
        title="Nova redução por produto"
        subtitle="A regra só se aplica quando o NCM e a descrição do item conferem."
      >
        <form onSubmit={submeterRegra} className="space-y-4">
          <Input
            label="NCM"
            value={ncm}
            onChange={(e) => setNcm(e.target.value)}
            placeholder="72142000"
            required
          />
          <Input
            label="Termos de inclusão"
            value={inclusao}
            onChange={(e) => setInclusao(e.target.value)}
            placeholder="vergalh*, verg ca"
            helperText={AJUDA_TERMOS}
            required
          />
          <Input
            label="Termos de exclusão (opcional)"
            value={exclusao}
            onChange={(e) => setExclusao(e.target.value)}
            placeholder="cobre, aluminio"
            helperText="Se algum destes casar, a regra é descartada para o item."
          />
          <Input
            label="Alíquota"
            value={aliquota}
            onChange={(e) => setAliquota(e.target.value)}
            placeholder="12,00"
            helperText="Aceita 12 ou 0.12."
            required
          />
          <Input
            label="Descrição (opcional)"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Vergalhões — Decreto 12.345"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalRegraAberto(false)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={criarRegra.isPending}>
              Cadastrar
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={regraDaExcecao !== null}
        onClose={() => setRegraDaExcecao(null)}
        title="Exceção para uma descrição específica"
        subtitle="Avaliada antes dos termos: resolve o caso que a regra erra, sem alterar a regra."
      >
        <form onSubmit={submeterExcecao} className="space-y-4">
          <div className="flex items-start gap-2 text-xs text-slate-600 bg-slate-50 rounded-lg p-3">
            <TriangleAlert className="w-4 h-4 shrink-0 text-amber-600" />
            <span>
              Informe a descrição como ela aparece na nota. Acento, caixa e pontuação são
              normalizados automaticamente.
            </span>
          </div>
          <Input
            label="Descrição exata"
            value={descricaoExata}
            onChange={(e) => setDescricaoExata(e.target.value)}
            placeholder="VERGALHAO DE COBRE"
            required
          />
          <Select
            label="Este produto se enquadra na redução?"
            value={enquadrado}
            onChange={(e) => setEnquadrado(e.target.value)}
            options={[
              { value: 'nao', label: 'Não — usar a alíquota normal' },
              { value: 'sim', label: 'Sim — aplicar a redução' },
            ]}
          />
          <Input
            label="Observação (opcional)"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Cobre não entra no decreto"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setRegraDaExcecao(null)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={criarExcecao.isPending}>
              Cadastrar exceção
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
};
