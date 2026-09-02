-- Small bilingual retrieval PROBE for the Phase 1 knowledge base — 4 agency-knowledge
-- documents (policy/SOP), English + Spanish each, deterministically paragraph-chunked.
-- PHI-free: no client names, no client identifiers, generic policy/SOP language only.
-- is_demo = true throughout (covered by purge_demo_data()/purge_demo_data_dry_run()).
--
-- NOT a real ingestion pipeline — this is a one-off probe seed to test
-- search_agency_knowledge() against real content before building any UI around it.

-- ============ 1. Attendance and Call-Off Policy ============
INSERT INTO public.knowledge_documents (id, agency_id, language, title, category, content, is_demo)
VALUES (
  'a1000000-0000-4000-8000-000000000001', '56fbfe38-e8eb-40c1-ba27-07428f62ed2e', 'en',
  'Attendance and Call-Off Policy', 'policy',
  $txt$Caregivers are expected to arrive at each scheduled shift on time and ready to work. If you are unable to report for a shift, you must notify your scheduler as far in advance as possible, and no later than two hours before the shift start time, except in a genuine emergency.

To report an absence, call the agency's on-call line directly — do not text, and do not notify the client or family yourself. The scheduler will confirm receipt of your call-off and work to find coverage.

Three unexcused absences or late call-offs within a rolling 90-day period may result in a formal written warning. A pattern of repeated last-minute call-offs affects client trust and may impact your standing for future shift assignments.

If you are sick, please stay home. Caregivers experiencing a fever, vomiting, or any contagious illness must not report to a shift and should call off immediately so a substitute can be arranged.$txt$,
  true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_documents (id, agency_id, language, title, category, content, is_demo)
VALUES (
  'a1000000-0000-4000-8000-000000000002', '56fbfe38-e8eb-40c1-ba27-07428f62ed2e', 'es',
  'Política de Asistencia y Ausencias', 'policy',
  $txt$Se espera que los cuidadores lleguen a cada turno programado a tiempo y listos para trabajar. Si no puede presentarse a un turno, debe notificar a su coordinador con la mayor anticipación posible, y a más tardar dos horas antes de la hora de inicio del turno, excepto en caso de una emergencia genuina.

Para reportar una ausencia, llame directamente a la línea de guardia de la agencia — no envíe mensajes de texto y no notifique al cliente ni a la familia usted mismo. El coordinador confirmará la recepción de su aviso y trabajará para encontrar cobertura.

Tres ausencias injustificadas o avisos de último momento dentro de un período móvil de 90 días pueden resultar en una advertencia formal por escrito. Un patrón de avisos repetidos de último momento afecta la confianza del cliente y puede afectar su posición para futuras asignaciones de turnos.

Si está enfermo, quédese en casa. Los cuidadores que presenten fiebre, vómitos o cualquier enfermedad contagiosa no deben presentarse a un turno y deben avisar de inmediato para que se pueda organizar un sustituto.$txt$,
  true
) ON CONFLICT (id) DO NOTHING;

-- ============ 2. Paid Time Off (PTO) Policy ============
INSERT INTO public.knowledge_documents (id, agency_id, language, title, category, content, is_demo)
VALUES (
  'a2000000-0000-4000-8000-000000000001', '56fbfe38-e8eb-40c1-ba27-07428f62ed2e', 'en',
  'Paid Time Off (PTO) Policy', 'policy',
  $txt$Full-time caregivers accrue paid time off (PTO) at a rate of one hour for every 30 hours worked, up to a maximum of 80 hours per calendar year. Part-time and on-call caregivers are not eligible for PTO accrual.

PTO requests must be submitted through the scheduling portal at least 14 days in advance for planned time off. Requests submitted with less notice will be reviewed on a case-by-case basis and are not guaranteed approval.

Unused PTO does not roll over to the next calendar year and is not paid out upon voluntary resignation. PTO is paid out only in cases of involuntary termination without cause, at the caregiver's current base hourly rate.

PTO cannot be used to cover a call-off for a shift that has already started. If you need to leave a shift early for a qualifying reason, contact your scheduler immediately rather than simply not returning.$txt$,
  true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_documents (id, agency_id, language, title, category, content, is_demo)
VALUES (
  'a2000000-0000-4000-8000-000000000002', '56fbfe38-e8eb-40c1-ba27-07428f62ed2e', 'es',
  'Política de Tiempo Libre Pagado (PTO)', 'policy',
  $txt$Los cuidadores de tiempo completo acumulan tiempo libre pagado (PTO) a razón de una hora por cada 30 horas trabajadas, hasta un máximo de 80 horas por año calendario. Los cuidadores de medio tiempo y de guardia no son elegibles para la acumulación de PTO.

Las solicitudes de PTO deben enviarse a través del portal de programación con al menos 14 días de anticipación para tiempo libre planificado. Las solicitudes enviadas con menos aviso se revisarán caso por caso y no se garantiza su aprobación.

El PTO no utilizado no se transfiere al siguiente año calendario y no se paga en caso de renuncia voluntaria. El PTO se paga únicamente en casos de terminación involuntaria sin causa, a la tarifa base por hora actual del cuidador.

El PTO no puede utilizarse para cubrir un aviso de ausencia de un turno que ya ha comenzado. Si necesita salir de un turno antes de tiempo por una razón justificada, comuníquese con su coordinador de inmediato en lugar de simplemente no regresar.$txt$,
  true
) ON CONFLICT (id) DO NOTHING;

-- ============ 3. Dementia Care Support — SOP ============
INSERT INTO public.knowledge_documents (id, agency_id, language, title, category, content, is_demo)
VALUES (
  'a3000000-0000-4000-8000-000000000001', '56fbfe38-e8eb-40c1-ba27-07428f62ed2e', 'en',
  'Dementia Care Support — Standard Operating Procedure', 'sop',
  $txt$When caring for a client with dementia or memory loss, maintain a calm, consistent routine. Sudden changes in schedule or environment can increase confusion and agitation. Introduce yourself by name at the start of every visit, even with clients you see regularly.

If a client becomes confused about time, place, or people, do not argue or attempt to forcefully correct them. Gently redirect the conversation to a comforting or familiar topic instead of insisting on the facts. Reality confrontation often increases distress without improving orientation.

Watch for signs of wandering behavior, especially near exterior doors. If a client attempts to leave the home unsupervised and this is outside their care plan, calmly redirect them to an activity rather than physically blocking their path unless there is an immediate safety risk.

Document any behavioral changes, increased confusion, or agitation in your shift notes, and notify your scheduler if a client's condition appears to be declining. Do not adjust medication timing or dosage under any circumstances — that is outside a caregiver's scope of practice.$txt$,
  true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_documents (id, agency_id, language, title, category, content, is_demo)
VALUES (
  'a3000000-0000-4000-8000-000000000002', '56fbfe38-e8eb-40c1-ba27-07428f62ed2e', 'es',
  'Atención a Clientes con Demencia — Procedimiento Operativo Estándar', 'sop',
  $txt$Al cuidar a un cliente con demencia o pérdida de memoria, mantenga una rutina calmada y constante. Los cambios repentinos en el horario o el entorno pueden aumentar la confusión y la agitación. Preséntese por su nombre al inicio de cada visita, incluso con clientes que ve regularmente.

Si un cliente se confunde sobre la hora, el lugar o las personas, no discuta ni intente corregirlo a la fuerza. En su lugar, redirija suavemente la conversación hacia un tema reconfortante o familiar en lugar de insistir en los hechos. Confrontar la realidad a menudo aumenta la angustia sin mejorar la orientación.

Esté atento a señales de deambulación, especialmente cerca de puertas exteriores. Si un cliente intenta salir de la casa sin supervisión y esto no está contemplado en su plan de cuidado, redirígalo con calma hacia una actividad en lugar de bloquear físicamente su camino, a menos que exista un riesgo inmediato para su seguridad.

Documente cualquier cambio de comportamiento, aumento de confusión o agitación en las notas de su turno, y notifique a su coordinador si la condición del cliente parece estar empeorando. No ajuste el horario ni la dosis de medicamentos bajo ninguna circunstancia — eso está fuera del alcance de práctica de un cuidador.$txt$,
  true
) ON CONFLICT (id) DO NOTHING;

-- ============ 4. Medication Reminder Guidelines ============
INSERT INTO public.knowledge_documents (id, agency_id, language, title, category, content, is_demo)
VALUES (
  'a4000000-0000-4000-8000-000000000001', '56fbfe38-e8eb-40c1-ba27-07428f62ed2e', 'en',
  'Medication Reminder Guidelines', 'sop',
  $txt$Caregivers may remind clients to take medication that the client or a family member has already set out and organized, such as in a labeled pill organizer. Caregivers must never open, count, sort, or handle a client's medication bottles directly.

Do not administer injections, insert or remove skin patches, or assist with any medication that requires medical judgment. These tasks require a licensed nurse and are outside the scope of a home care caregiver.

If a client refuses a reminded medication, do not insist or attempt to persuade them repeatedly. Note the refusal in your shift notes and inform your scheduler so the family or care coordinator can follow up.

If you ever notice a client's pills appear incorrect, missing, or the labeled organizer looks tampered with, do not attempt to correct it yourself. Contact your scheduler immediately so a nurse or family member can verify the medication setup.$txt$,
  true
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_documents (id, agency_id, language, title, category, content, is_demo)
VALUES (
  'a4000000-0000-4000-8000-000000000002', '56fbfe38-e8eb-40c1-ba27-07428f62ed2e', 'es',
  'Pautas para Recordatorios de Medicamentos', 'sop',
  $txt$Los cuidadores pueden recordarle al cliente que tome un medicamento que el cliente o un familiar ya haya preparado y organizado, como en un organizador de pastillas etiquetado. Los cuidadores nunca deben abrir, contar, clasificar ni manipular directamente los frascos de medicamentos del cliente.

No administre inyecciones, ni coloque o retire parches cutáneos, ni ayude con ningún medicamento que requiera criterio médico. Estas tareas requieren una enfermera con licencia y están fuera del alcance de un cuidador de atención domiciliaria.

Si un cliente rechaza un medicamento recordado, no insista ni intente persuadirlo repetidamente. Anote el rechazo en las notas de su turno e informe a su coordinador para que la familia o el coordinador de cuidados puedan dar seguimiento.

Si alguna vez nota que las pastillas de un cliente parecen incorrectas, faltantes, o que el organizador etiquetado parece haber sido manipulado, no intente corregirlo usted mismo. Comuníquese de inmediato con su coordinador para que una enfermera o familiar pueda verificar la configuración de los medicamentos.$txt$,
  true
) ON CONFLICT (id) DO NOTHING;

-- ============ Deterministic paragraph chunking (split on blank line, no LLM) ============
-- One INSERT per paragraph, chunk_index in reading order. 8 documents x 4 paragraphs = 32 chunks.

-- Doc 1 EN chunks
INSERT INTO public.knowledge_chunks (document_id, language, chunk_index, content, is_demo) VALUES
('a1000000-0000-4000-8000-000000000001', 'en', 0, $txt$Caregivers are expected to arrive at each scheduled shift on time and ready to work. If you are unable to report for a shift, you must notify your scheduler as far in advance as possible, and no later than two hours before the shift start time, except in a genuine emergency.$txt$, true),
('a1000000-0000-4000-8000-000000000001', 'en', 1, $txt$To report an absence, call the agency's on-call line directly — do not text, and do not notify the client or family yourself. The scheduler will confirm receipt of your call-off and work to find coverage.$txt$, true),
('a1000000-0000-4000-8000-000000000001', 'en', 2, $txt$Three unexcused absences or late call-offs within a rolling 90-day period may result in a formal written warning. A pattern of repeated last-minute call-offs affects client trust and may impact your standing for future shift assignments.$txt$, true),
('a1000000-0000-4000-8000-000000000001', 'en', 3, $txt$If you are sick, please stay home. Caregivers experiencing a fever, vomiting, or any contagious illness must not report to a shift and should call off immediately so a substitute can be arranged.$txt$, true);

-- Doc 1 ES chunks
INSERT INTO public.knowledge_chunks (document_id, language, chunk_index, content, is_demo) VALUES
('a1000000-0000-4000-8000-000000000002', 'es', 0, $txt$Se espera que los cuidadores lleguen a cada turno programado a tiempo y listos para trabajar. Si no puede presentarse a un turno, debe notificar a su coordinador con la mayor anticipación posible, y a más tardar dos horas antes de la hora de inicio del turno, excepto en caso de una emergencia genuina.$txt$, true),
('a1000000-0000-4000-8000-000000000002', 'es', 1, $txt$Para reportar una ausencia, llame directamente a la línea de guardia de la agencia — no envíe mensajes de texto y no notifique al cliente ni a la familia usted mismo. El coordinador confirmará la recepción de su aviso y trabajará para encontrar cobertura.$txt$, true),
('a1000000-0000-4000-8000-000000000002', 'es', 2, $txt$Tres ausencias injustificadas o avisos de último momento dentro de un período móvil de 90 días pueden resultar en una advertencia formal por escrito. Un patrón de avisos repetidos de último momento afecta la confianza del cliente y puede afectar su posición para futuras asignaciones de turnos.$txt$, true),
('a1000000-0000-4000-8000-000000000002', 'es', 3, $txt$Si está enfermo, quédese en casa. Los cuidadores que presenten fiebre, vómitos o cualquier enfermedad contagiosa no deben presentarse a un turno y deben avisar de inmediato para que se pueda organizar un sustituto.$txt$, true);

-- Doc 2 EN chunks
INSERT INTO public.knowledge_chunks (document_id, language, chunk_index, content, is_demo) VALUES
('a2000000-0000-4000-8000-000000000001', 'en', 0, $txt$Full-time caregivers accrue paid time off (PTO) at a rate of one hour for every 30 hours worked, up to a maximum of 80 hours per calendar year. Part-time and on-call caregivers are not eligible for PTO accrual.$txt$, true),
('a2000000-0000-4000-8000-000000000001', 'en', 1, $txt$PTO requests must be submitted through the scheduling portal at least 14 days in advance for planned time off. Requests submitted with less notice will be reviewed on a case-by-case basis and are not guaranteed approval.$txt$, true),
('a2000000-0000-4000-8000-000000000001', 'en', 2, $txt$Unused PTO does not roll over to the next calendar year and is not paid out upon voluntary resignation. PTO is paid out only in cases of involuntary termination without cause, at the caregiver's current base hourly rate.$txt$, true),
('a2000000-0000-4000-8000-000000000001', 'en', 3, $txt$PTO cannot be used to cover a call-off for a shift that has already started. If you need to leave a shift early for a qualifying reason, contact your scheduler immediately rather than simply not returning.$txt$, true);

-- Doc 2 ES chunks
INSERT INTO public.knowledge_chunks (document_id, language, chunk_index, content, is_demo) VALUES
('a2000000-0000-4000-8000-000000000002', 'es', 0, $txt$Los cuidadores de tiempo completo acumulan tiempo libre pagado (PTO) a razón de una hora por cada 30 horas trabajadas, hasta un máximo de 80 horas por año calendario. Los cuidadores de medio tiempo y de guardia no son elegibles para la acumulación de PTO.$txt$, true),
('a2000000-0000-4000-8000-000000000002', 'es', 1, $txt$Las solicitudes de PTO deben enviarse a través del portal de programación con al menos 14 días de anticipación para tiempo libre planificado. Las solicitudes enviadas con menos aviso se revisarán caso por caso y no se garantiza su aprobación.$txt$, true),
('a2000000-0000-4000-8000-000000000002', 'es', 2, $txt$El PTO no utilizado no se transfiere al siguiente año calendario y no se paga en caso de renuncia voluntaria. El PTO se paga únicamente en casos de terminación involuntaria sin causa, a la tarifa base por hora actual del cuidador.$txt$, true),
('a2000000-0000-4000-8000-000000000002', 'es', 3, $txt$El PTO no puede utilizarse para cubrir un aviso de ausencia de un turno que ya ha comenzado. Si necesita salir de un turno antes de tiempo por una razón justificada, comuníquese con su coordinador de inmediato en lugar de simplemente no regresar.$txt$, true);

-- Doc 3 EN chunks
INSERT INTO public.knowledge_chunks (document_id, language, chunk_index, content, is_demo) VALUES
('a3000000-0000-4000-8000-000000000001', 'en', 0, $txt$When caring for a client with dementia or memory loss, maintain a calm, consistent routine. Sudden changes in schedule or environment can increase confusion and agitation. Introduce yourself by name at the start of every visit, even with clients you see regularly.$txt$, true),
('a3000000-0000-4000-8000-000000000001', 'en', 1, $txt$If a client becomes confused about time, place, or people, do not argue or attempt to forcefully correct them. Gently redirect the conversation to a comforting or familiar topic instead of insisting on the facts. Reality confrontation often increases distress without improving orientation.$txt$, true),
('a3000000-0000-4000-8000-000000000001', 'en', 2, $txt$Watch for signs of wandering behavior, especially near exterior doors. If a client attempts to leave the home unsupervised and this is outside their care plan, calmly redirect them to an activity rather than physically blocking their path unless there is an immediate safety risk.$txt$, true),
('a3000000-0000-4000-8000-000000000001', 'en', 3, $txt$Document any behavioral changes, increased confusion, or agitation in your shift notes, and notify your scheduler if a client's condition appears to be declining. Do not adjust medication timing or dosage under any circumstances — that is outside a caregiver's scope of practice.$txt$, true);

-- Doc 3 ES chunks
INSERT INTO public.knowledge_chunks (document_id, language, chunk_index, content, is_demo) VALUES
('a3000000-0000-4000-8000-000000000002', 'es', 0, $txt$Al cuidar a un cliente con demencia o pérdida de memoria, mantenga una rutina calmada y constante. Los cambios repentinos en el horario o el entorno pueden aumentar la confusión y la agitación. Preséntese por su nombre al inicio de cada visita, incluso con clientes que ve regularmente.$txt$, true),
('a3000000-0000-4000-8000-000000000002', 'es', 1, $txt$Si un cliente se confunde sobre la hora, el lugar o las personas, no discuta ni intente corregirlo a la fuerza. En su lugar, redirija suavemente la conversación hacia un tema reconfortante o familiar en lugar de insistir en los hechos. Confrontar la realidad a menudo aumenta la angustia sin mejorar la orientación.$txt$, true),
('a3000000-0000-4000-8000-000000000002', 'es', 2, $txt$Esté atento a señales de deambulación, especialmente cerca de puertas exteriores. Si un cliente intenta salir de la casa sin supervisión y esto no está contemplado en su plan de cuidado, redirígalo con calma hacia una actividad en lugar de bloquear físicamente su camino, a menos que exista un riesgo inmediato para su seguridad.$txt$, true),
('a3000000-0000-4000-8000-000000000002', 'es', 3, $txt$Documente cualquier cambio de comportamiento, aumento de confusión o agitación en las notas de su turno, y notifique a su coordinador si la condición del cliente parece estar empeorando. No ajuste el horario ni la dosis de medicamentos bajo ninguna circunstancia — eso está fuera del alcance de práctica de un cuidador.$txt$, true);

-- Doc 4 EN chunks
INSERT INTO public.knowledge_chunks (document_id, language, chunk_index, content, is_demo) VALUES
('a4000000-0000-4000-8000-000000000001', 'en', 0, $txt$Caregivers may remind clients to take medication that the client or a family member has already set out and organized, such as in a labeled pill organizer. Caregivers must never open, count, sort, or handle a client's medication bottles directly.$txt$, true),
('a4000000-0000-4000-8000-000000000001', 'en', 1, $txt$Do not administer injections, insert or remove skin patches, or assist with any medication that requires medical judgment. These tasks require a licensed nurse and are outside the scope of a home care caregiver.$txt$, true),
('a4000000-0000-4000-8000-000000000001', 'en', 2, $txt$If a client refuses a reminded medication, do not insist or attempt to persuade them repeatedly. Note the refusal in your shift notes and inform your scheduler so the family or care coordinator can follow up.$txt$, true),
('a4000000-0000-4000-8000-000000000001', 'en', 3, $txt$If you ever notice a client's pills appear incorrect, missing, or the labeled organizer looks tampered with, do not attempt to correct it yourself. Contact your scheduler immediately so a nurse or family member can verify the medication setup.$txt$, true);

-- Doc 4 ES chunks
INSERT INTO public.knowledge_chunks (document_id, language, chunk_index, content, is_demo) VALUES
('a4000000-0000-4000-8000-000000000002', 'es', 0, $txt$Los cuidadores pueden recordarle al cliente que tome un medicamento que el cliente o un familiar ya haya preparado y organizado, como en un organizador de pastillas etiquetado. Los cuidadores nunca deben abrir, contar, clasificar ni manipular directamente los frascos de medicamentos del cliente.$txt$, true),
('a4000000-0000-4000-8000-000000000002', 'es', 1, $txt$No administre inyecciones, ni coloque o retire parches cutáneos, ni ayude con ningún medicamento que requiera criterio médico. Estas tareas requieren una enfermera con licencia y están fuera del alcance de un cuidador de atención domiciliaria.$txt$, true),
('a4000000-0000-4000-8000-000000000002', 'es', 2, $txt$Si un cliente rechaza un medicamento recordado, no insista ni intente persuadirlo repetidamente. Anote el rechazo en las notas de su turno e informe a su coordinador para que la familia o el coordinador de cuidados puedan dar seguimiento.$txt$, true),
('a4000000-0000-4000-8000-000000000002', 'es', 3, $txt$Si alguna vez nota que las pastillas de un cliente parecen incorrectas, faltantes, o que el organizador etiquetado parece haber sido manipulado, no intente corregirlo usted mismo. Comuníquese de inmediato con su coordinador para que una enfermera o familiar pueda verificar la configuración de los medicamentos.$txt$, true);
