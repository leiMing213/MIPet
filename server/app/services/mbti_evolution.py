import json
import logging
from datetime import datetime, timedelta, timezone

from app.agno.prompts import MBTI_PROFILES
from app.agno.registry import get_or_create_agent, invalidate_pet_agents
from app.database import database
from app.schemas import MbtiConfirmResult, MbtiEvaluationResult, MbtiTriggerStatus, QuestionAnswer

logger = logging.getLogger(__name__)

FIRST_TRIGGER_DAYS = 3
FIRST_TRIGGER_INTERACTIONS = 30
REGULAR_TRIGGER_DAYS = 7
REGULAR_TRIGGER_INTERACTIONS = 50
COOLDOWN_DAYS = 3


class MbtiEvolutionService:
    def check_trigger(self, pet_id: str) -> MbtiTriggerStatus:
        snapshot = database.get_pet(pet_id)
        if not snapshot:
            return MbtiTriggerStatus(
                should_trigger=False, reason=None,
                days_since_creation=0, days_since_last_eval=None,
                interaction_count_since_last=0,
            )

        now = datetime.now(timezone.utc)
        created_at = datetime.fromisoformat(snapshot.profile.created_at)
        days_since_creation = (now - created_at).days

        last_eval = database.latest_mbti_evaluation(pet_id)
        is_first = last_eval is None

        if last_eval:
            last_eval_at = datetime.fromisoformat(last_eval.created_at)
            days_since_last_eval = (now - last_eval_at).days
            since_timestamp = last_eval.created_at
        else:
            days_since_last_eval = None
            since_timestamp = snapshot.profile.created_at

        interaction_count = database.count_interactions_since(pet_id, since_timestamp)

        # Cooldown check
        if days_since_last_eval is not None and days_since_last_eval < COOLDOWN_DAYS:
            return MbtiTriggerStatus(
                should_trigger=False, reason=None,
                days_since_creation=days_since_creation,
                days_since_last_eval=days_since_last_eval,
                interaction_count_since_last=interaction_count,
            )

        trigger_days = FIRST_TRIGGER_DAYS if is_first else REGULAR_TRIGGER_DAYS
        trigger_interactions = FIRST_TRIGGER_INTERACTIONS if is_first else REGULAR_TRIGGER_INTERACTIONS

        elapsed_days = days_since_last_eval if days_since_last_eval is not None else days_since_creation

        reason = None
        if elapsed_days >= trigger_days:
            reason = "time"
        elif interaction_count >= trigger_interactions:
            reason = "interaction_count"

        return MbtiTriggerStatus(
            should_trigger=reason is not None,
            reason=reason,
            days_since_creation=days_since_creation,
            days_since_last_eval=days_since_last_eval,
            interaction_count_since_last=interaction_count,
        )

    async def evaluate(self, pet_id: str, answers: list[QuestionAnswer], trigger_type: str, session_id: str | None = None) -> MbtiEvaluationResult:
        snapshot = database.get_pet(pet_id)
        if not snapshot:
            raise ValueError(f"Pet {pet_id} not found")

        old_mbti = snapshot.profile.mbti
        questions = database.list_mbti_questions(pet_id)

        # Calculate dimension scores from answers
        dimension_scores = self._calculate_dimension_scores(questions, answers)

        # Store evaluation record
        answers_data = [a.model_dump() for a in answers]
        eval_id = database.create_mbti_evaluation(
            pet_id=pet_id,
            trigger_type=trigger_type,
            answers_json=json.dumps(answers_data, ensure_ascii=False),
            old_mbti=old_mbti,
        )

        # Build evaluation prompt for the agent
        profile = MBTI_PROFILES.get(old_mbti, MBTI_PROFILES["INFP"])
        eval_prompt = self._build_eval_prompt(old_mbti, profile, dimension_scores)

        # Call agent for evaluation
        agent = get_or_create_agent(
            pet_id, snapshot.profile.name, snapshot.profile.species, old_mbti, session_id=session_id
        )

        suggested_mbti = None
        reasoning = "评定失败，无法获取结果。"
        changed = False

        if agent:
            try:
                response = await agent.arun(eval_prompt, stream=False)
                content = response.content.strip() if response.content else ""
                content = content.removeprefix("```json").removesuffix("```").strip()
                result = json.loads(content)
                suggested_mbti = result.get("suggested_mbti")
                reasoning = result.get("reasoning", "")
                changed = bool(result.get("should_change", False))
                if not changed:
                    suggested_mbti = None
            except Exception:
                logger.exception("MBTI evaluation agent call failed")

        database.update_mbti_evaluation_result(eval_id, suggested_mbti, reasoning)

        return MbtiEvaluationResult(
            evaluation_id=eval_id,
            old_mbti=old_mbti,
            suggested_mbti=suggested_mbti,
            reasoning=reasoning,
            changed=changed,
        )

    def confirm(self, pet_id: str, evaluation_id: int, confirmed: bool) -> MbtiConfirmResult:
        evaluation = database.get_mbti_evaluation(evaluation_id)
        if not evaluation:
            raise ValueError(f"Evaluation {evaluation_id} not found")

        database.confirm_mbti_evaluation(evaluation_id, confirmed)

        changed = False
        current_mbti = evaluation.old_mbti

        if confirmed and evaluation.suggested_mbti:
            database.update_pet_mbti(pet_id, evaluation.suggested_mbti)
            invalidate_pet_agents(pet_id)
            current_mbti = evaluation.suggested_mbti
            changed = True

        return MbtiConfirmResult(mbti=current_mbti, changed=changed)

    def _calculate_dimension_scores(self, questions, answers: list[QuestionAnswer]) -> dict[str, float]:
        question_map = {q.id: q for q in questions}
        dimensions = {"EI": 0.0, "SN": 0.0, "TF": 0.0, "JP": 0.0}
        dimension_counts = {"EI": 0, "SN": 0, "TF": 0, "JP": 0}

        for answer in answers:
            q = question_map.get(answer.question_id)
            if not q or answer.selected_option_index >= len(q.options):
                continue
            option = q.options[answer.selected_option_index]
            score = 1.0 if option.direction == "+" else -1.0
            dimensions[option.dimension] += score
            dimension_counts[option.dimension] += 1

        # Normalize to [-1, 1]
        for dim in dimensions:
            if dimension_counts[dim] > 0:
                dimensions[dim] /= dimension_counts[dim]

        return dimensions

    def _build_eval_prompt(self, old_mbti: str, profile: dict, dimension_scores: dict[str, float]) -> str:
        scores_text = "\n".join([
            f"- E/I 维度：{dimension_scores['EI']:+.2f}（正值偏E外向，负值偏I内向）",
            f"- S/N 维度：{dimension_scores['SN']:+.2f}（正值偏S感觉，负值偏N直觉）",
            f"- T/F 维度：{dimension_scores['TF']:+.2f}（正值偏T思考，负值偏F情感）",
            f"- J/P 维度：{dimension_scores['JP']:+.2f}（正值偏J判断，负值偏P感知）",
        ])

        return f"""[MBTI性格评定指令]

请使用 get_skill_instructions 工具获取 "mbti_evaluation" 技能的完整评定规则，然后按照规则执行评定。

当前宠物MBTI：{old_mbti}（{profile['name']}）
当前性格描述：{profile['voice']}

问卷维度得分（-1到+1范围）：
{scores_text}

请调用相关工具获取历史数据，综合分析后输出评定结果JSON。"""


mbti_evolution_service = MbtiEvolutionService()
