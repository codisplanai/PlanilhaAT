import { CheckCircle2 } from 'lucide-react';

const REQUEST_STEPS = [
  { num: 1, label: 'Empresa' },
  { num: 2, label: 'Período' },
  { num: 3, label: 'Arquivos' },
  { num: 4, label: 'Download' },
] as const;

interface RequestStepperProps {
  currentStep: number;
  completed: boolean;
}

export function RequestStepper({ currentStep, completed }: RequestStepperProps) {
  return (
    <nav aria-label="Etapas da solicitação" className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-xs">
      <ol className="flex items-center justify-between">
        {REQUEST_STEPS.map((step, index) => {
          const isDone = currentStep > step.num || (currentStep === 4 && completed);
          const isCurrent = currentStep === step.num;
          return (
            <li key={step.num} className="flex-1 flex items-center" aria-current={isCurrent ? 'step' : undefined}>
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold transition-all duration-200 select-none ${
                    isDone
                      ? 'bg-emerald-600 text-white shadow-xs shadow-emerald-600/20'
                      : isCurrent
                        ? 'bg-blue-700 text-white shadow-xs shadow-blue-600/25 ring-4 ring-blue-500/15'
                        : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {isDone ? <CheckCircle2 className="w-4 h-4" /> : step.num}
                </div>
                <div className="hidden sm:block">
                  <p
                    className={`text-xs font-bold leading-tight ${
                      isCurrent ? 'text-blue-950' : isDone ? 'text-slate-800' : 'text-slate-400'
                    }`}
                  >
                    {step.label}
                  </p>
                  <p className="text-[10px] text-slate-400 font-medium">Etapa {step.num}</p>
                </div>
              </div>
              {index < REQUEST_STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-2 sm:mx-4 transition-colors duration-200 rounded-full ${
                    currentStep > step.num ? 'bg-emerald-500' : 'bg-slate-200'
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
      <div className="sm:hidden text-center text-xs font-bold text-blue-900 mt-2.5 pt-2 border-t border-slate-100">
        Etapa {currentStep} de 4: {REQUEST_STEPS[currentStep - 1]?.label}
      </div>
    </nav>
  );
}
